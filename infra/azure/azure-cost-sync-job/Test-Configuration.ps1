#requires -Version 7.2
<#! Read-only verification. No deploy/start/update/role-create/Secret-value command exists in this script. !#>
param([switch]$CheckProd, [string]$SnapshotPath, [string]$OutputDirectory)
$ErrorActionPreference='Stop'
if($CheckProd -and $SnapshotPath){throw 'Choose live PROD or an offline snapshot, not both.'}
if(-not $OutputDirectory){$OutputDirectory=Join-Path ([IO.Path]::GetTempPath()) ('juple-cost-iac-'+[guid]::NewGuid().ToString('N'))}
$null=New-Item -ItemType Directory -Path $OutputDirectory -Force
& bicep lint (Join-Path $PSScriptRoot 'main.bicep')
if($LASTEXITCODE -ne 0){throw 'Bicep lint failed'}
& bicep build (Join-Path $PSScriptRoot 'main.bicep') --outfile (Join-Path $OutputDirectory 'main.json')
if($LASTEXITCODE -ne 0){throw 'Bicep build failed'}
& bicep build-params (Join-Path $PSScriptRoot 'prod.bicepparam') --outfile (Join-Path $OutputDirectory 'prod.parameters.json')
if($LASTEXITCODE -ne 0){throw 'Bicep parameters build failed'}
$template=Get-Content (Join-Path $OutputDirectory 'main.json') -Raw|ConvertFrom-Json -AsHashtable
$parameters=Get-Content (Join-Path $OutputDirectory 'prod.parameters.json') -Raw|ConvertFrom-Json -AsHashtable
$values=@{}
foreach($key in $template.parameters.Keys){if($template.parameters[$key].ContainsKey('defaultValue')){$values[$key]=$template.parameters[$key].defaultValue}}
foreach($key in $parameters.parameters.Keys){$values[$key]=$parameters.parameters[$key].value}

# Evaluate only the small pure ARM-expression subset emitted by this template. Never Invoke-Expression.
function Split-Arguments([string]$Text){
 $parts=[Collections.Generic.List[string]]::new();$depth=0;$quoted=$false;$start=0
 for($i=0;$i -lt $Text.Length;$i++){
  $c=$Text[$i]
  if($c -eq "'"){if($quoted -and $i+1 -lt $Text.Length -and $Text[$i+1] -eq "'"){$i++;continue};$quoted=-not $quoted}
  elseif(-not $quoted){if($c -eq '('){$depth++}elseif($c -eq ')'){$depth--}elseif($c -eq ',' -and $depth -eq 0){$parts.Add($Text.Substring($start,$i-$start).Trim());$start=$i+1}}
 }
 if($quoted -or $depth -ne 0){throw 'Unbalanced ARM expression'}
 if($Text.Trim()){$parts.Add($Text.Substring($start).Trim())}
 return ,$parts.ToArray()
}
function Resolve-Expression([string]$Text){
 $Text=$Text.Trim()
 if($Text.StartsWith("'") -and $Text.EndsWith("'")){return $Text.Substring(1,$Text.Length-2).Replace("''", "'")}
 if($Text -match '^-?\d+$'){return [long]$Text}
 if($Text -notmatch '^([a-zA-Z]+)\((.*)\)$'){throw "Unsupported ARM expression: $Text"}
 $name=$Matches[1];$arguments=Split-Arguments $Matches[2]
 $args=@(foreach($arg in $arguments){Resolve-Expression $arg})
 switch($name){
  'parameters' {if(-not $values.ContainsKey($args[0])){throw 'Missing ARM parameter'};return $values[$args[0]]}
  'format' {return [string]::Format([Globalization.CultureInfo]::InvariantCulture,[string]$args[0],[object[]]@($args|Select-Object -Skip 1))}
  'json' {return ConvertFrom-Json -AsHashtable $args[0]}
  'string' {if($args[0] -is [bool]){return $args[0].ToString().ToLowerInvariant()};return [string]$args[0]}
  'equals' {return $args[0] -ceq $args[1]}
  'if' {if($args[0]){return $args[1]}else{return $args[2]}}
  'null' {return $null}
  'createObject' {$object=@{};for($j=0;$j -lt $args.Count;$j+=2){$object[$args[$j]]=$args[$j+1]};return $object}
  default {throw "Unsupported ARM function: $name"}
 }
}
function Resolve-Value($Value){
 if($Value -is [Collections.IDictionary]){$o=@{};foreach($key in $Value.Keys){$o[(Resolve-Value $key)]=Resolve-Value $Value[$key]};return $o}
 if($Value -is [array]){return ,@($Value|ForEach-Object{Resolve-Value $_})}
 if($Value -is [string] -and $Value.StartsWith('[') -and $Value.EndsWith(']')){return Resolve-Expression $Value.Substring(1,$Value.Length-2)}
 return $Value
}
function Stable($Value){
 if($Value -is [Collections.IDictionary]){$o=[ordered]@{};foreach($key in @($Value.Keys|Sort-Object -CaseSensitive)){$o[$key]=Stable $Value[$key]};return $o}
 if($Value -is [array]){return ,@($Value|ForEach-Object{Stable $_})}
 return $Value
}
function Canonical-Job($InputJob){
 $job=$InputJob|ConvertTo-Json -Depth 80|ConvertFrom-Json -AsHashtable
 # Only documented server-owned/read-only metadata is omitted. Unknown settings remain and fail comparison.
 $out=@{name=$job.name;type=$job.type.ToLowerInvariant();location=$job.location.Replace(' ','').ToLowerInvariant();tags=$job.tags;identity=$job.identity;properties=$job.properties}
 foreach($key in @('provisioningState','runningStatus','eventStreamEndpoint','outboundIpAddresses')){$out.properties.Remove($key)}
 foreach($id in @($out.identity.userAssignedIdentities.Keys)){foreach($key in @('clientId','principalId')){$out.identity.userAssignedIdentities[$id].Remove($key)}}
 foreach($key in @('dapr','eventTriggerConfig','identitySettings','manualTriggerConfig','scheduleTriggerConfig')){if($out.properties.configuration.ContainsKey($key) -and $null -eq $out.properties.configuration[$key]){$out.properties.configuration.Remove($key)}}
 # The original PUT omitted identitySettings; Azure's Job GET returned [] (no per-identity overrides).
 if($out.properties.configuration.identitySettings -is [array] -and $out.properties.configuration.identitySettings.Count -eq 0){$out.properties.configuration.Remove('identitySettings')}
 foreach($key in @('initContainers','volumes')){if($out.properties.template.ContainsKey($key) -and ($null -eq $out.properties.template[$key] -or @($out.properties.template[$key]).Count -eq 0)){$out.properties.template.Remove($key)}}
 foreach($container in $out.properties.template.containers){
  # Azure adds this discriminator; only explicit ContainerImage is the omitted user-image default.
  if($container.imageType -ceq 'ContainerImage'){$container.Remove('imageType')}
  $container.env=@($container.env|Sort-Object name)
 }
 $out.properties.configuration.registries=@($out.properties.configuration.registries|Sort-Object server)
 $out.properties.configuration.secrets=@($out.properties.configuration.secrets|Sort-Object name)
 foreach($secret in $out.properties.configuration.secrets){if($secret.value){throw 'Secret values must not be captured or compared'};if($secret.ContainsKey('value') -and $null -eq $secret.value){$secret.Remove('value')}}
 return $out
}
function Read-AzureJson([string[]]$Arguments){
 $command=Get-Command az -CommandType Application|Select-Object -First 1
 $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=$command.Source
 if($command.Source.EndsWith('.cmd')){$info.FileName=Join-Path (Split-Path (Split-Path $command.Source)) 'python.exe';foreach($v in @('-IBm','azure.cli')){$info.ArgumentList.Add($v)}}
 foreach($v in $Arguments){$info.ArgumentList.Add($v)}
 $info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
 $p=[Diagnostics.Process]::new();$p.StartInfo=$info
 try{$null=$p.Start();$stdout=$p.StandardOutput.ReadToEndAsync();$stderr=$p.StandardError.ReadToEndAsync();if(-not $p.WaitForExit(60000)){$p.Kill($true);throw 'Azure read timed out'};if($p.ExitCode -ne 0){throw 'Azure read failed; raw CLI diagnostics suppressed'};return $stdout.GetAwaiter().GetResult()|ConvertFrom-Json -AsHashtable}finally{$p.Dispose()}
}

if(@($template.resources).Count -ne 1 -or $template.resources[0].type -cne 'Microsoft.App/jobs'){throw 'Template must manage only the cost Job'}
$expected=Resolve-Value $template.resources[0]
$provenance=Get-Content (Join-Path $PSScriptRoot 'production.provenance.json') -Raw|ConvertFrom-Json -AsHashtable
if($values.imageDigest -notmatch '^sha256:[0-9a-f]{64}$' -or $values.imageDigest -cne $provenance.imageDigest -or $values.sourceArchiveSha256 -cne $provenance.sourceArchiveSha256){throw 'Image/source provenance drift'}
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$source=(Get-Content (Join-Path $repo 'backend/src/Juple.Api/Program.cs') -Raw).Replace("`r`n","`n")
$start=$source.IndexOf('// Dedicated RG-scoped cost job.');$end=$source.IndexOf('if (isRetentionCleanupJob)', $start)
if($start -lt 0 -or $end -lt $start){throw 'Missing dedicated deployed entry point'}
$checksum=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($source.Substring($start,$end-$start)))).ToLowerInvariant()
if($checksum -cne $provenance.entryPointBlockSha256 -or $source -notmatch 'var isOneShotJob = [^;]*isAzureCostSyncJob;' -or -not $source.Contains('var isAzureCostSyncJob = args.Contains("--run-azure-cost-sync", StringComparer.Ordinal);')){throw 'Deployed entry point changed'}
$docker=Get-Content (Join-Path $repo 'backend/src/Juple.Api/Dockerfile') -Raw
if(-not $docker.Contains('ENTRYPOINT ["dotnet", "Juple.Api.dll"]')){throw 'Image entrypoint source changed'}
$canonical=Canonical-Job $expected
$canonical|ConvertTo-Json -Depth 80|Set-Content (Join-Path $OutputDirectory 'expected-job.json')
$result=@{Bicep='PASS';EntryPoint='MATCH';Image=$values.imageDigest;Mode='Offline';OutputDirectory=$OutputDirectory}
if($CheckProd){
 $actual=Read-AzureJson @('containerapp','job','show','--subscription',$provenance.subscriptionId,'-g',$provenance.resourceGroup,'-n',$provenance.jobName,'--only-show-errors','-o','json')
 $scope="/subscriptions/$($provenance.subscriptionId)/resourceGroups/$($provenance.resourceGroup)"
 $roles=Read-AzureJson @('role','assignment','list','--scope',$scope,'--fill-principal-name','false','--only-show-errors','-o','json')
 $role=@($roles|Where-Object{$_.name -ceq $provenance.existingCostReaderAssignmentName -and $_.principalId -ceq $provenance.identityPrincipalId -and $_.scope -ceq $scope -and $_.roleDefinitionId.EndsWith('/'+$provenance.costReaderRoleDefinitionId)})
 if($role.Count -ne 1){throw 'Expected existing RG-scoped Cost Management Reader not found'}
 $result.Rbac='MATCH (read-only verification; template creates no grant)'
 $result.Mode='PROD read-only'
}elseif($SnapshotPath){$actual=Get-Content $SnapshotPath -Raw|ConvertFrom-Json -AsHashtable;$result.Mode='Snapshot'}
if($CheckProd -or $SnapshotPath){
 $observed=Canonical-Job $actual
 $observed|ConvertTo-Json -Depth 80|Set-Content (Join-Path $OutputDirectory 'observed-job.json')
 if((ConvertTo-Json (Stable $observed) -Depth 80 -Compress)-cne(ConvertTo-Json (Stable $canonical) -Depth 80 -Compress)){throw "PROD configuration differs; compare expected-job.json / observed-job.json in $OutputDirectory"}
 $result.Configuration='MATCH (all managed fields)'
}
$result|ConvertTo-Json -Depth 8
