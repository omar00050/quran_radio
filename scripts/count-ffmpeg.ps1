# Count running ffmpeg processes to verify audio-server refactor impact.
# On the audio-server host, expect ~35 ffmpeg processes (one per unique station).
# In bot processes with AUDIO_MODE=remote, expect 0 ffmpeg processes.

$processes = Get-Process ffmpeg -ErrorAction SilentlyContinue
if ($null -eq $processes) {
  Write-Output "Total ffmpeg processes: 0"
} else {
  $count = @($processes).Count
  Write-Output "Total ffmpeg processes: $count"
  Write-Output ""

  $table = $processes | Select-Object -Property @(
    "Id",
    "StartTime",
    @{Name="WorkingSet(MB)"; Expression={[math]::Round($_.WorkingSet / 1MB, 2)}}
  )
  $table | Format-Table -AutoSize
}
