"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Slider } from "@/components/ui/slider"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Play, Pause, Square, Camera, AlertTriangle, CheckCircle, Moon, Sun } from "lucide-react"
import { usePostureMonitor } from "@/lib/posture"

export default function PostureMonitor() {
  const [isMonitoring, setIsMonitoring] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [postureScore, setPostureScore] = useState(85)
  const [forwardThreshold, setForwardThreshold] = useState([100])
  const [sideThreshold, setSideThreshold] = useState([100])
  const [neckThreshold, setNeckThreshold] = useState([100])
  const videoRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | undefined>(undefined)
  const [loadingDevices, setLoadingDevices] = useState(false)
  const [deviceError, setDeviceError] = useState<string | null>(null)
  const [audioEnabled, setAudioEnabled] = useState(true)
  const lastSpokenRef = useRef<{ [k: string]: number }>({})
  const SPEAK_COOLDOWN_MS = 5000
  const [isDark, setIsDark] = useState(false)

  const { status, baselineSet, captureBaseline } = usePostureMonitor(
    videoRef.current,
    isMonitoring,
    isPaused,
    { overlayCanvas: overlayRef.current }
  )

  useEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    if (isDark) {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }, [isDark])

  const enumerateVideoDevices = async () => {
    setLoadingDevices(true)
    setDeviceError(null)
    try {
      // Ensure labels are available: need permission
      const devicesList = await navigator.mediaDevices.enumerateDevices()
      const videoInputs = devicesList.filter(d => d.kind === 'videoinput')
      setDevices(videoInputs)
      if (!selectedDeviceId && videoInputs.length > 0) {
        setSelectedDeviceId(videoInputs[0].deviceId)
      }
    } catch (e: any) {
      setDeviceError(e?.message || 'Failed to list devices')
    } finally {
      setLoadingDevices(false)
    }
  }

  useEffect(() => {
    // Initial enumeration attempt
    enumerateVideoDevices()
    // Listen for device changes (e.g., phone connects)
    const handler = () => enumerateVideoDevices()
    navigator.mediaDevices.addEventListener('devicechange', handler)
    return () => navigator.mediaDevices.removeEventListener('devicechange', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (videoRef.current && selectedDeviceId) {
      const streamVideo = async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined }
          })
          const videoEl = videoRef.current
          if (videoEl) {
            videoEl.srcObject = stream
          }
        } catch (error) {
          console.error("Error accessing camera:", error)
        }
      }

      streamVideo()
    }
  }, [selectedDeviceId, videoRef])

  const startMonitoring = async () => {
    try {
      const constraints: MediaStreamConstraints = {
        video: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : { facingMode: 'user' }
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
      setIsMonitoring(true)
      setIsPaused(false)
      // After starting, refresh labels (now permission granted) if they were blank
      if (devices.length === 0 || devices.some(d => !d.label)) {
        enumerateVideoDevices()
      }
    } catch (error) {
      console.error("Error accessing camera:", error)
      setDeviceError((error as any)?.message || 'Camera access denied')
    }
  }

  const pauseMonitoring = () => {
    setIsPaused(!isPaused)
  }

  const stopCurrentStream = () => {
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop())
      videoRef.current.srcObject = null
    }
  }

  const stopMonitoring = () => {
    setIsMonitoring(false)
    setIsPaused(false)
    stopCurrentStream()
  }

  const getPostureStatus = () => {
    if (status.score >= 85) return { status: "Excellent", color: "bg-secondary", icon: CheckCircle }
    if (status.score >= 70) return { status: "Good", color: "bg-secondary/70", icon: CheckCircle }
    if (status.score >= 50) return { status: "Fair", color: "bg-accent", icon: AlertTriangle }
    return { status: "Poor", color: "bg-destructive", icon: AlertTriangle }
  }

  const postureStatus = getPostureStatus()
  const StatusIcon = postureStatus.icon

  useEffect(() => {
    const switchStream = async () => {
      if (!isMonitoring || !selectedDeviceId) return
      try {
        stopCurrentStream()
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: selectedDeviceId } }
        })
        if (videoRef.current) videoRef.current.srcObject = stream
      } catch (e) {
        console.warn('Failed to switch camera', e)
        setDeviceError('Failed to switch camera')
      }
    }
    switchStream()
  }, [selectedDeviceId, isMonitoring])

  useEffect(() => {
    if (!audioEnabled) return
    if (!baselineSet) return
    if (typeof window === 'undefined') return
    const synth = window.speechSynthesis
    if (!synth) return
    status.warnings.forEach(w => {
      const now = Date.now()
      const last = lastSpokenRef.current[w] || 0
      if (now - last < SPEAK_COOLDOWN_MS) return
      lastSpokenRef.current[w] = now
      const utter = new SpeechSynthesisUtterance(w.replace(/ detected/i, '').replace(/ posture/i,'').trim())
      utter.rate = 1
      utter.pitch = 1
      synth.speak(utter)
    })
  }, [status.warnings, audioEnabled, baselineSet])

  return (
    <>
    <div className="min-h-screen bg-background p-10 space-y-10">
      <header className="text-center space-y-2">
        <h1 className="text-4xl font-bold text-foreground">Posture-Pal</h1>
        <p className="text-muted-foreground text-lg">Real-time sitting posture analysis and correction</p>
      </header>

      <div className="max-w-6xl mx-auto flex justify-center">
        <div className="flex gap-6 items-start">
          <Card className="flex-shrink-0 basis-[42rem] max-w-[42rem]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Camera className="h-5 w-5" />
                Live Camera Feed
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative aspect-video bg-muted rounded-lg overflow-hidden">
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                <canvas ref={overlayRef} className="absolute inset-0 w-full h-full pointer-events-none" />
                {!isMonitoring && (
                  <div className="absolute inset-0 flex items-center justify-center bg-muted/50">
                    <p className="text-muted-foreground">Camera feed will appear here</p>
                  </div>
                )}
                {isMonitoring && baselineSet && (
                  <div className="absolute top-4 right-4 space-y-2">
                    <Badge className={`${postureStatus.color} text-white`}>
                      <StatusIcon className="h-4 w-4 mr-1" />
                      {postureStatus.status}
                    </Badge>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-4 w-80">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex flex-col w-full">
                  <CardTitle className="text-lg font-medium">Forward Lean</CardTitle>
                  <span className="text-sm font-medium tabular-nums mt-1 self-end">{forwardThreshold[0]}%</span>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <Slider
                  value={forwardThreshold}
                  onValueChange={setForwardThreshold}
                  max={100}
                  min={0}
                  step={5}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground mt-2">
                  <span>Lenient</span>
                  <span>Strict</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <div className="flex flex-col w-full">
                  <CardTitle className="text-lg font-medium">Side Lean</CardTitle>
                  <span className="text-sm font-medium tabular-nums mt-1 self-end">{sideThreshold[0]}%</span>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <Slider
                  value={sideThreshold}
                  onValueChange={setSideThreshold}
                  max={100}
                  min={0}
                  step={5}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground mt-2">
                  <span>Lenient</span>
                  <span>Strict</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <div className="flex flex-col w-full">
                  <CardTitle className="text-lg font-medium">Head Down</CardTitle>
                  <span className="text-sm font-medium tabular-nums mt-1 self-end">{neckThreshold[0]}%</span>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <Slider
                  value={neckThreshold}
                  onValueChange={setNeckThreshold}
                  max={100}
                  min={0}
                  step={5}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground mt-2">
                  <span>Lenient</span>
                  <span>Strict</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Control Buttons */}
      <div className="flex flex-col items-center gap-3">
        <div className="flex gap-2 items-center flex-wrap justify-center">
          {/* select camera */}
          <select
            className="border rounded-md px-2 py-2.5 bg-background text-sm"
            value={selectedDeviceId || ''}
            onChange={e => setSelectedDeviceId(e.target.value || undefined)}
            disabled={loadingDevices}
          >
            {devices.length === 0 && <option value="">{loadingDevices ? 'Loading cameras...' : 'No cameras'}</option>}
            {devices.map(d => (
              <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${d.deviceId.slice(0,6)}`}</option>
            ))}
          </select>
          {!isMonitoring ? (
            <Button onClick={startMonitoring} size="lg" className="gap-2">
              <Play className="h-5 w-5" />
              Start Detection
            </Button>
          ) : (
            <>
              <Button onClick={pauseMonitoring} variant="secondary" size="lg" className="gap-2">
                {isPaused ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
                {isPaused ? "Resume" : "Pause"}
              </Button>
              <Button onClick={stopMonitoring} variant="destructive" size="lg" className="gap-2">
                <Square className="h-5 w-5" />
                End Detection
              </Button>
              <Button onClick={captureBaseline} size="lg" className="gap-2">
                <Camera className="h-5 w-5" />
                Capture Baseline
              </Button>
            </>
          )}
        </div>
        {deviceError && <p className="text-sm text-destructive">{deviceError}</p>}
        <div className="flex items-center gap-2 text-sm mt-2">
          <input id="audio-toggle" type="checkbox" className="accent-primary" checked={audioEnabled} onChange={e=>setAudioEnabled(e.target.checked)} />
          <label htmlFor="audio-toggle" className="cursor-pointer select-none">Sound alerts</label>
        </div>
      </div>

      {/* Warnings Section */}
      {status.warnings.length > 0 && (
        <div className="max-w-4xl mx-auto space-y-3">
          {/* <h3 className="text-lg font-semibold text-foreground">Posture Alerts</h3> */}
          {status.warnings.map((warning, index) => (
            <Alert key={index} variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{warning}</AlertDescription>
            </Alert>
          ))}
        </div>
      )}

      {/* Status Dashboard */}
      {isMonitoring && baselineSet && (
        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <CardTitle>Monitoring Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span>Detection Status:</span>
              <Badge variant={isPaused ? "secondary" : "default"}>{isPaused ? "Paused" : "Active"}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span>Overall Posture Score:</span>
              <span className="text-2xl font-bold text-primary">{status.score}%</span>
            </div>
            <div className="w-full bg-muted rounded-full h-3">
              <div
                className={`h-3 rounded-full transition-all duration-500 ${
                  status.score >= 70 ? "bg-secondary" : status.score >= 50 ? "bg-accent" : "bg-destructive"
                }`}
                style={{ width: `${status.score}%` }}
              />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
    {/* Floating dark mode toggle button */}
    <div className="fixed bottom-4 right-4">
      <Button
        onClick={() => setIsDark(!isDark)}
        className="p-6 rounded-full shadow-md bg-muted hover:bg-muted/80 transition-colors"
        aria-label="Toggle dark mode"
      >
        {isDark ? <Sun className="h-5 w-5 text-yellow-500" /> : <Moon className="h-5 w-5 text-primary" />}
      </Button>
    </div>
    </>
  )
}
