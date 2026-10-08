# Generates one WAV per scene from src/data/narration.json with a built-in Windows voice.
# Replace any public/vo/<Scene>.wav with your own recording (or another TTS) and re-run
# `node scripts/vo-durations.mjs` to re-time the video.
param([string]$Voice = 'Microsoft David Desktop', [int]$Rate = 0)
Add-Type -AssemblyName System.Speech
$root = Split-Path -Parent $PSScriptRoot
$lines = Get-Content -Raw (Join-Path $root 'src/data/narration.json') | ConvertFrom-Json
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice($Voice)
$synth.Rate = $Rate
foreach ($p in $lines.PSObject.Properties) {
  $out = Join-Path $root "public/vo/$($p.Name).wav"
  $synth.SetOutputToWaveFile($out)
  $synth.Speak($p.Value)
  $synth.SetOutputToNull()
  Write-Output "wrote $out"
}
$synth.Dispose()
