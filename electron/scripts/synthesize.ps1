param(
  [Parameter(Mandatory = $true)][string]$TextPath,
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [int]$Rate = 0
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech
$text = Get-Content -LiteralPath $TextPath -Raw
$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $voice.Rate = [Math]::Max(-3, [Math]::Min(3, $Rate))
  $voice.Volume = 100
  $voice.SetOutputToWaveFile($OutputPath)
  $voice.Speak($text)
}
finally {
  $voice.Dispose()
}
