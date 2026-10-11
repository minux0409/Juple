// Minimal operations monitoring for one environment (resource group scope): a workspace-based
// Application Insights component on the Foundation's existing Log Analytics workspace, one action group
// and four deliberately small alerts. Its own lifecycle - like ../foundation/billing.bicep it is deployed
// separately and nothing else depends on it, so a Dev/Prod Foundation or App deployment is unaffected.
//
// What this is NOT: the backend has no Application Insights / OpenTelemetry SDK yet (only structured
// logs, which the Container Apps environment already sends to Log Analytics). This template creates the
// Azure resources and the connection string only; no telemetry flows from the application until
// instrumentation is added in a separate, reviewed code change. The alerts below do not need it - they
// use platform metrics and the Container Apps logs that already exist.
//
// Alerts (kept to what an on-call person must act on - no CPU/memory/latency noise yet):
//   1. API 5xx burst                  - Container Apps metric Requests, statusCodeCategory = 5xx
//   2. App / worker restarting        - Container Apps metric RestartCount, one rule per app (API, web, workers)
//   3. Scheduled Job failing          - Container Apps system logs: non-zero exit or DeadlineExceeded
//   4. Service Bus dead letters       - namespace metric DeadletteredMessages > 0
// Alerts 1 and 2 reference Container Apps by name and can only be created once those apps exist - they
// are switched on with containerAppAlertsEnabled in a second deployment. Alerts 3 and 4 only need the
// workspace and the namespace, which exist after the Foundation.
targetScope = 'resourceGroup'

@description('Short environment name - must match the Foundation deployment this is layered on top of.')
param environmentName string

param location string = resourceGroup().location

@description('Name of the Foundation Log Analytics workspace. Defaults to the Foundation naming pattern.')
param logAnalyticsWorkspaceName string = 'log-juple-${environmentName}'

@description('Name of the existing Service Bus namespace (Foundation output "serviceBusNamespaceName") whose dead-letter queues are watched.')
param serviceBusNamespaceName string

@description('E-mail address that receives alerts - the on-call mailbox. No default and never guessed: the deployment fails without it. Not a secret, but an operator decision, so it is supplied at deploy time.')
@minLength(3)
param alertEmailAddress string

@description('false (default): create only the Application Insights component, the action group and the alerts that need no Container App (Job failures, Service Bus dead letters). true: also create the Container App metric alerts (API 5xx, restarts) - deploy that only after the apps exist, or the deployment fails on the missing resource.')
param containerAppAlertsEnabled bool = false

@description('Container App names the metric alerts watch. Defaults follow the Foundation/App naming patterns.')
param apiContainerAppName string = 'ca-juple-api-${environmentName}'
param restartWatchedContainerAppNames array = [
  'ca-juple-api-${environmentName}'
  'ca-juple-web-${environmentName}'
  'ca-juple-notify-worker-${environmentName}'
  'ca-juple-billing-worker-${environmentName}'
]

@description('Alert 1: 5xx responses summed over 5 minutes above which the alert fires.')
@minValue(1)
param api5xxThreshold int = 10

@description('Alert 2: restarts of one app container summed over 15 minutes above which the alert fires.')
@minValue(1)
param restartThreshold int = 3

@description('Alert 3: failed executions of one Job within 30 minutes at or above which the alert fires. A single transient failure is retried by the next schedule tick, so 1 would be noise for the per-minute Jobs. The Instagram-metadata Job sometimes hits its short deadline by design - raise this if it proves noisy.')
@minValue(1)
param jobFailureThreshold int = 3

var applicationInsightsName = 'appi-juple-${environmentName}'
var actionGroupName = 'ag-juple-${environmentName}'

resource logAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2022-10-01' existing = {
  name: logAnalyticsWorkspaceName
}

resource serviceBusNamespace 'Microsoft.ServiceBus/namespaces@2022-10-01-preview' existing = {
  name: serviceBusNamespaceName
}

// Workspace-based: telemetry is stored in the Foundation's Log Analytics workspace (one retention policy,
// one place to query), not in a classic standalone component.
resource applicationInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: applicationInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalyticsWorkspace.id
    IngestionMode: 'LogAnalytics'
  }
}

resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: actionGroupName
  location: 'global'
  properties: {
    groupShortName: take('juple${environmentName}', 12)
    enabled: true
    emailReceivers: [
      {
        name: 'on-call'
        emailAddress: alertEmailAddress
        useCommonAlertSchema: true
      }
    ]
  }
}

// 1. API 5xx burst.
resource api5xxAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = if (containerAppAlertsEnabled) {
  name: 'alert-juple-${environmentName}-api-5xx'
  location: 'global'
  properties: {
    description: 'The API returned more than ${api5xxThreshold} 5xx responses within 5 minutes.'
    severity: 1
    enabled: true
    scopes: [
      resourceId('Microsoft.App/containerApps', apiContainerAppName)
    ]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'api5xx'
          criterionType: 'StaticThresholdCriterion'
          metricName: 'Requests'
          metricNamespace: 'Microsoft.App/containerApps'
          dimensions: [
            {
              name: 'statusCodeCategory'
              operator: 'Include'
              values: [
                '5xx'
              ]
            }
          ]
          operator: 'GreaterThan'
          threshold: api5xxThreshold
          timeAggregation: 'Total'
        }
      ]
    }
    actions: [
      {
        actionGroupId: actionGroup.id
      }
    ]
  }
}

// 2. An app or worker container that keeps restarting (crash loop). One rule per app: Azure Monitor does
// not support multi-resource metric alerts for Microsoft.App/containerApps (checked with a what-if
// preflight), so a single rule cannot watch the API, web and both workers.
resource restartAlerts 'Microsoft.Insights/metricAlerts@2018-03-01' = [for appName in restartWatchedContainerAppNames: if (containerAppAlertsEnabled) {
  name: 'alert-${appName}-restarts'
  location: 'global'
  properties: {
    description: '${appName} restarted more than ${restartThreshold} times within 15 minutes.'
    severity: 2
    enabled: true
    scopes: [
      resourceId('Microsoft.App/containerApps', appName)
    ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'restarts'
          criterionType: 'StaticThresholdCriterion'
          metricName: 'RestartCount'
          metricNamespace: 'Microsoft.App/containerApps'
          operator: 'GreaterThan'
          threshold: restartThreshold
          timeAggregation: 'Total'
        }
      ]
    }
    actions: [
      {
        actionGroupId: actionGroup.id
      }
    ]
  }
}]

// 3. A scheduled Job that fails. A Container Apps Job has no failure metric, so this reads the platform's
// system log: a terminated container with a non-zero exit code, or the replica timeout (DeadlineExceeded).
// Column and reason names were checked against the live Dev workspace.
resource jobFailureAlert 'Microsoft.Insights/scheduledQueryRules@2022-06-15' = {
  name: 'alert-juple-${environmentName}-job-failures'
  location: location
  properties: {
    displayName: 'Juple ${environmentName}: scheduled Job failing'
    description: 'A Container Apps Job failed (non-zero exit or deadline exceeded) at least ${jobFailureThreshold} times within 30 minutes.'
    severity: 2
    enabled: true
    scopes: [
      logAnalyticsWorkspace.id
    ]
    evaluationFrequency: 'PT15M'
    windowSize: 'PT30M'
    criteria: {
      allOf: [
        {
          query: 'ContainerAppSystemLogs_CL | where isnotempty(JobName_s) | where (Reason_s == "ContainerTerminated" and Log_s !has "exit code \'0\'") or Reason_s == "DeadlineExceeded" | summarize Failures = count() by JobName_s | where Failures >= ${jobFailureThreshold}'
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: {
      actionGroups: [
        actionGroup.id
      ]
    }
  }
}

// 4. Dead-lettered messages in any queue of the namespace. The notification pipeline's signals are only
// wake-ups (SQL is the source of truth), but a billing event or a malformed message in the DLQ needs a
// person to look; zero is the normal state.
resource deadLetterAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'alert-juple-${environmentName}-servicebus-dlq'
  location: 'global'
  properties: {
    description: 'There are dead-lettered messages in a Service Bus queue.'
    severity: 2
    enabled: true
    scopes: [
      serviceBusNamespace.id
    ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'deadLetters'
          criterionType: 'StaticThresholdCriterion'
          metricName: 'DeadletteredMessages'
          metricNamespace: 'Microsoft.ServiceBus/namespaces'
          operator: 'GreaterThan'
          threshold: 0
          timeAggregation: 'Maximum'
        }
      ]
    }
    actions: [
      {
        actionGroupId: actionGroup.id
      }
    ]
  }
}

output applicationInsightsName string = applicationInsights.name

@description('Pass to the API / workers as applicationInsightsConnectionString. Inert until the backend has telemetry instrumentation.')
output applicationInsightsConnectionString string = applicationInsights.properties.ConnectionString

output actionGroupName string = actionGroup.name
