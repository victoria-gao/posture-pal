"use client"

import { useEffect, useRef, useState, useCallback } from "react"

// Public status shape
export type PostureStatus = {
  score: number
  warnings: string[]
  raw: {
    forwardDiff?: number
    sideDiff?: number
    angleDiff?: number
  }
}

/**
 * Hook: usePostureMonitor
 * Wraps MediaPipe Pose in the browser, reproducing Python logic (baseline diffs + sliding windows).
 */
export function usePostureMonitor(
  videoEl: HTMLVideoElement | null,
  isActive: boolean,
  isPaused: boolean,
  opts: { fps?: number; overlayCanvas?: HTMLCanvasElement | null; resetOnStop?: boolean } = {}
) {
  const poseRef = useRef<any | null>(null)
  const lastLandmarksRef = useRef<any[] | null>(null)
  const baselineRef = useRef<{
    head_forward: number
    head_side_slouch: number
    head_angle: number
  } | null>(null)

  // Sliding window logic mirrors Python's constants
  const WINDOW_SIZE = 100
  const REQUIRED_BAD = 90
  const slouchWindow = useRef<number[]>([])
  const sideWindow = useRef<number[]>([])
  const headWindow = useRef<number[]>([])

  const [status, setStatus] = useState<PostureStatus>({ score: 100, warnings: [], raw: {} })
  const [baselineSet, setBaselineSet] = useState(false)

  const targetFPS = opts.fps ?? 30
  const resetOnStop = opts.resetOnStop ?? true
  const frameInterval = 1000 / targetFPS
  const lastFrameTs = useRef(0)
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null)
  overlayCanvasRef.current = opts.overlayCanvas ?? null

  const drawingUtilsRef = useRef<{
    drawConnectors: Function
    drawLandmarks: Function
  } | null>(null)

  const angleBetween = (p1: any, p2: any, p3: any) => {
    const v1 = [p1.x - p2.x, p1.y - p2.y]
    const v2 = [p3.x - p2.x, p3.y - p2.y]
    const dot = v1[0] * v2[0] + v1[1] * v2[1]
    const mag1 = Math.hypot(...v1)
    const mag2 = Math.hypot(...v2)
    if (!mag1 || !mag2) return 0
    const cos = Math.min(1, Math.max(-1, dot / (mag1 * mag2)))
    return (Math.acos(cos) * 180) / Math.PI
  }

  const computeBaseline = useCallback((lm: any[]) => {
    if (!lm) return
    const nose = lm[0]
    const leftEar = lm[7]
    const rightShoulder = lm[12]
    const leftShoulder = lm[11]
    const leftHip = lm[23]
    const head_forward = rightShoulder.x - leftEar.x
    const head_side_slouch = Math.abs(leftEar.z - leftHip.z)
    const head_angle = angleBetween(leftShoulder, leftEar, nose)
    baselineRef.current = { head_forward, head_side_slouch, head_angle }
    setBaselineSet(true)
    // Reset windows & warnings
    slouchWindow.current = []
    sideWindow.current = []
    headWindow.current = []
    setStatus(s => ({ ...s, warnings: [] }))
  }, [])

  const pushWindow = (ref: React.MutableRefObject<number[]>, v: number) => {
    if (ref.current.length >= WINDOW_SIZE) ref.current.shift()
    ref.current.push(v)
  }

  const captureBaseline = useCallback(() => {
    if (lastLandmarksRef.current) computeBaseline(lastLandmarksRef.current)
  }, [computeBaseline])

  const clearWarnings = () => setStatus(s => ({ ...s, warnings: [] }))

  useEffect(() => {
    if (!videoEl || !isActive) return
    let cancelled = false
    let rafId = 0

    const init = async () => {
      try {
  const mp = await import("@mediapipe/pose")
        if (cancelled) return
        if (poseRef.current) return // already initialized (hot reload guard)
        const { Pose } = mp
        // Explicitly pin the version to avoid CDN 'latest' race leading to asset map mismatch
        const POSE_VERSION = '0.5.1675469404'
        const pose = new Pose({
          locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose@${POSE_VERSION}/${file}`
        })
        pose.setOptions({
          modelComplexity: 1,
          enableSegmentation: false,
          minDetectionConfidence: 0.7,
          minTrackingConfidence: 0.7
        })

        // Await internal WASM / assets init to reduce race conditions
        if ((pose as any).initialize) {
          try { await (pose as any).initialize() } catch (e) { console.warn('Pose initialize failed (continuing)', e) }
        }

        // Lazy load drawing utils only if an overlay canvas was provided
        if (overlayCanvasRef.current && !drawingUtilsRef.current) {
          try {
            const du = await import('@mediapipe/drawing_utils')
            drawingUtilsRef.current = {
              drawConnectors: du.drawConnectors,
              drawLandmarks: du.drawLandmarks,
            }
          } catch (e) {
            console.warn('Failed to load drawing utils', e)
          }
        }

        pose.onResults((res: any) => {
          try {
            if (cancelled || isPaused) return
            const lm = res?.poseLandmarks
            if (!lm) return
            lastLandmarksRef.current = lm
            // We still draw landmarks even if baseline not yet set
            const baselineAvailable = !!baselineRef.current

            const nose = lm[0]
            const leftEar = lm[7]
            const rightShoulder = lm[12]
            const leftShoulder = lm[11]
            const leftHip = lm[23]

            const head_forward = rightShoulder.x - leftEar.x
            const head_side_slouch = Math.abs(leftEar.z - leftHip.z)
            const head_angle = angleBetween(leftShoulder, leftEar, nose)

            let forward_diff = 0, side_diff = 0, angle_diff = 0
            let is_slouch = false, is_side = false, is_head = false
            if (baselineAvailable) {
              const base = baselineRef.current!
              forward_diff = Math.abs(head_forward - base.head_forward)
              side_diff = Math.abs(head_side_slouch - base.head_side_slouch)
              angle_diff = Math.abs(head_angle - base.head_angle)

              is_slouch = forward_diff > 0.01
              is_side = side_diff > 0.05
              is_head = angle_diff > 10

              pushWindow(slouchWindow, is_slouch ? 1 : 0)
              pushWindow(sideWindow, is_side ? 1 : 0)
              pushWindow(headWindow, is_head ? 1 : 0)
            }

            const warnings: string[] = []
            if (slouchWindow.current.length === WINDOW_SIZE && slouchWindow.current.reduce((a,b)=>a+b,0) >= REQUIRED_BAD)
              warnings.push('Forward lean detected')
            if (sideWindow.current.length === WINDOW_SIZE && sideWindow.current.reduce((a,b)=>a+b,0) >= REQUIRED_BAD)
              warnings.push('Side lean detected')
            if (headWindow.current.length === WINDOW_SIZE && headWindow.current.reduce((a,b)=>a+b,0) >= REQUIRED_BAD)
              warnings.push('Head lowered detected')

            let score = 100
            if (baselineAvailable) {
              if (is_slouch) score -= 20
              if (is_side) score -= 15
              if (is_head) score -= 15
              score = Math.max(0, score)
            }

            if (baselineAvailable) {
              setStatus(s => ({
                ...s,
                score,
                warnings,
                raw: { forwardDiff: forward_diff, sideDiff: side_diff, angleDiff: angle_diff }
              }))
            }

            // Drawing overlay
            const overlay = overlayCanvasRef.current
            if (overlay && drawingUtilsRef.current) {
              const ctx2 = overlay.getContext('2d')
              if (ctx2) {
                // Ensure canvas matches underlying video size
                if (overlay.width !== videoEl.videoWidth || overlay.height !== videoEl.videoHeight) {
                  overlay.width = videoEl.videoWidth
                  overlay.height = videoEl.videoHeight
                }
                ctx2.save()
                ctx2.clearRect(0,0, overlay.width, overlay.height)
                try {
                  drawingUtilsRef.current.drawConnectors(ctx2, lm, (mp as any).POSE_CONNECTIONS, { color: '#ffffffff', lineWidth: 2 })
                  drawingUtilsRef.current.drawLandmarks(ctx2, lm, { color: '#ff0a0aff', radius: 1 })
                } catch (e) {
                  // Avoid spamming if drawing fails
                }
                ctx2.restore()
              }
            }
          } catch (err) {
            console.error('Pose onResults processing error', err)
          }
        })
        poseRef.current = pose

        const canvas = document.createElement("canvas")
        const ctx = canvas.getContext("2d")

        const startLoop = () => {
          const loop = (ts: number) => {
            if (cancelled) return
            if (isPaused) { rafId = requestAnimationFrame(loop); return }
            if (videoEl.videoWidth > 0 && (ts - lastFrameTs.current >= frameInterval)) {
              lastFrameTs.current = ts
              canvas.width = videoEl.videoWidth
              canvas.height = videoEl.videoHeight
              ctx?.drawImage(videoEl, 0, 0, canvas.width, canvas.height)
              pose.send({ image: canvas })
            }
            rafId = requestAnimationFrame(loop)
          }
          rafId = requestAnimationFrame(loop)
        }
        if (videoEl.readyState >= 2) {
          startLoop()
        } else {
          const onMeta = () => { startLoop(); videoEl.removeEventListener('loadedmetadata', onMeta) }
          videoEl.addEventListener('loadedmetadata', onMeta)
        }
      } catch (e) {
        console.error("Pose init failed", e)
      }
    }

    init()
    return () => {
      cancelled = true
      if (rafId) cancelAnimationFrame(rafId)
      if (poseRef.current?.close) {
        try { poseRef.current.close() } catch {}
      }
      poseRef.current = null
    }
  }, [videoEl, isActive, isPaused, frameInterval])

  // Clear overlay & optionally reset when deactivated
  useEffect(() => {
    if (!isActive) {
      const overlay = overlayCanvasRef.current
      if (overlay) {
        const ctx = overlay.getContext('2d')
        if (ctx) ctx.clearRect(0,0, overlay.width, overlay.height)
      }
      if (resetOnStop) {
        baselineRef.current = null
        setBaselineSet(false)
        setStatus({ score: 100, warnings: [], raw: {} })
        slouchWindow.current = []
        sideWindow.current = []
        headWindow.current = []
      }
    }
  }, [isActive])

  return {
    status,
    baselineSet, // useful for conditionally showing score and badge
    captureBaseline,
    clearWarnings,
  }
}