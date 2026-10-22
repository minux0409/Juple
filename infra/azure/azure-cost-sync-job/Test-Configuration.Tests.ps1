#requires -Version 7.2
# Synthetic snapshots only: no Azure access, account tokens, database writes, or real Secret values.
$ErrorActionPreference='Stop'
$dir=Join-Path ([IO.Path]::GetTempPath()) ('juple-cost-iac-regressions-'+[guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory $dir
$null=& (Join-Path $PSScriptRoot 'Test-Configuration.ps1') -OutputDirectory (Join-Path $dir 'baseline')
$baseline=Get-Content (Join-Path $dir 'baseline/expected-job.json') -Raw|ConvertFrom-Json -AsHashtable
$cases=@(
 @{Name='Azure defaults';Accept=$true;Change={param($j) $j.properties.configuration.identitySettings=@();$j.properties.configuration.dapr=$null;$j.properties.template.volumes=$null;$j.properties.template.containers[0].imageType='ContainerImage';$j.location='Korea Central'}},
 @{Name='CloudBuild discriminator';Accept=$false;Change={param($j) $j.properties.template.containers[0].imageType='CloudBuild'}},
 @{Name='Different image digest';Accept=$false;Change={param($j) $j.properties.template.containers[0].image='registry.example/other@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'}},
 @{Name='Different Secret reference';Accept=$false;Change={param($j) $j.properties.template.containers[0].env[2].secretRef='different-secret'}},
 @{Name='Different identity';Accept=$false;Change={param($j) $j.identity.type='SystemAssigned'}},
 @{Name='Different schedule';Accept=$false;Change={param($j) $j.properties.configuration.scheduleTriggerConfig.cronExpression='* * * * *'}},
 @{Name='Identity availability overrides';Accept=$false;Change={param($j) $j.properties.configuration.identitySettings=@(@{identity='different';lifecycle='None'})}},
 @{Name='Unknown nonempty setting';Accept=$false;Change={param($j) $j.properties.configuration.customMetricsSettings=@{unexpected='value'}}}
)
$i=0
foreach($case in $cases){
 $copy=$baseline|ConvertTo-Json -Depth 80|ConvertFrom-Json -AsHashtable
 & $case.Change $copy
 $snapshot=Join-Path $dir "case-$i.json";$copy|ConvertTo-Json -Depth 80|Set-Content $snapshot
 $accepted=$false
 try{$null=& (Join-Path $PSScriptRoot 'Test-Configuration.ps1') -SnapshotPath $snapshot -OutputDirectory (Join-Path $dir "case-$i");$accepted=$true}
 catch{if($_.Exception.Message -notlike 'PROD configuration differs;*'){throw}}
 if($accepted -ne $case.Accept){throw "Incorrect drift decision: $($case.Name)"}
 $i++
}
@{Passed=$cases.Count;Failed=0;AzureCalls=0;Artifacts=$dir}|ConvertTo-Json
