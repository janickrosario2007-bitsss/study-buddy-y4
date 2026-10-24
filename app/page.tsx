'use client'

import { useEffect, useRef, useState } from 'react'
import {
  BookOpen,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  FileImage,
  Lightbulb,
  Loader2,
  Mic,
  RotateCcw,
  Sparkles,
  Speaker,
  Upload,
  X,
} from 'lucide-react'
import useSWRImmutable from 'swr/immutable'
import { Button } from '@/components/ui/button'
import { uploadHomeworkImage } from '@/lib/uploadImage'
import { readJson } from '@/lib/read-json'

async function speak(text: string): Promise<void> {
  try {
    const res = await fetch('/api/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!res.ok) return
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    await new Promise<void>((resolve) => {
      const done = () => {
        URL.revokeObjectURL(url)
        resolve()
      }
      audio.onended = done
      audio.onerror = done
      audio.play().catch(done)
    })
  } catch {
    // Speech is a progressive enhancement; ignore playback/network failures.
  }
}

type ChatMessage = { role: 'tutor' | 'student'; text: string }
type VoiceStatus = 'idle' | 'listening' | 'thinking' | 'speaking'

const voiceStatusLabel: Record<VoiceStatus, string> = {
  idle: 'Tap mic → speak → tap again to stop',
  listening: 'Recording... tap mic to stop',
  thinking: 'Thinking...',
  speaking: 'Speaking...',
}

function VoiceChat({ subject, context }: { subject: string; context: string }) {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    return () => {
      const recorder = mediaRecorderRef.current
      if (!recorder) return
      recorder.onstop = null
      if (recorder.state !== 'inactive') recorder.stop()
      recorder.stream.getTracks().forEach((track) => track.stop())
    }
  }, [])

  async function handleRecordingStop(stream: MediaStream, mediaRecorder: MediaRecorder) {
    stream.getTracks().forEach((track) => track.stop())
    setStatus('thinking')
    try {
      const actualMimeType = mediaRecorder.mimeType || 'audio/webm'
      const blob = new Blob(chunksRef.current, { type: actualMimeType })

      if (blob.size < 1000) {
        setMessages((prev) => [
          ...prev,
          { role: 'tutor', text: "I couldn't hear that clearly. Tap the mic, speak, then tap again to stop." },
        ])
        return
      }

      const ext = actualMimeType.includes('mp4') ? 'mp4' : 'webm'
      const form = new FormData()
      form.append('audio', blob, `recording.${ext}`)

      const listenRes = await fetch('/api/listen', { method: 'POST', body: form })
      if (!listenRes.ok) throw new Error("I couldn't hear that. Please try again.")
      const { text: userText } = await listenRes.json()

      if (!userText?.trim()) {
        setMessages((prev) => [
          ...prev,
          { role: 'tutor', text: "I didn't catch that. Please speak clearly and try again." },
        ])
        return
      }

      setMessages((prev) => [...prev, { role: 'student', text: userText }])

      const chatRes = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userText, subject, context }),
      })
      const chatData = await readJson<{ reply?: string }>(chatRes)
      if (!chatRes.ok || !chatData?.reply) throw new Error(chatData?.error ?? 'The tutor is unavailable right now.')
      const { reply } = chatData
      setMessages((prev) => [...prev, { role: 'tutor', text: reply }])

      setStatus('speaking')
      await speak(reply)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setStatus('idle')
    }
  }

  async function handleMicClick() {
    if (status === 'listening') {
      mediaRecorderRef.current?.stop()
      return
    }
    if (status !== 'idle') return
    setError(null)

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : MediaRecorder.isTypeSupported('audio/mp4')
            ? 'audio/mp4'
            : ''
      const mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder
      chunksRef.current = []
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      mediaRecorder.onstop = () => handleRecordingStop(stream, mediaRecorder)
      mediaRecorder.start()
      setStatus('listening')
    } catch {
      setError('Microphone access was blocked. Allow it in your browser to talk to your tutor.')
      setStatus('idle')
    }
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-xl hover:bg-indigo-700 print:hidden"
      >
        <Mic className="size-4" />
        Ask your tutor
      </button>
    )
  }

  const isBusy = status === 'thinking' || status === 'speaking'

  return (
    <div className="fixed bottom-6 right-6 z-50 flex w-80 flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl print:hidden">
      <div className="flex items-center justify-between rounded-t-2xl bg-indigo-600 px-4 py-3">
        <div className="flex items-center gap-2 text-white">
          <Mic className="size-4" />
          <span className="text-sm font-semibold">Voice Tutor</span>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="text-indigo-200 hover:text-white"
          aria-label="Close voice tutor"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex max-h-64 min-h-[100px] flex-col gap-2 overflow-y-auto p-4" aria-live="polite">
        {messages.length === 0 && (
          <p className="mt-4 text-center text-sm text-slate-400">
            Tap the mic and ask me anything about your homework.
          </p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-6 ${
              msg.role === 'tutor' ? 'self-start bg-indigo-50 text-indigo-900' : 'self-end bg-slate-100 text-slate-800'
            }`}
          >
            {msg.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="flex flex-col items-center gap-2 border-t border-slate-100 p-4">
        {error ? (
          <p className="text-center text-xs text-red-600">{error}</p>
        ) : (
          <p className="text-xs text-slate-400">{voiceStatusLabel[status]}</p>
        )}
        <button
          onClick={handleMicClick}
          disabled={isBusy}
          aria-label={status === 'listening' ? 'Stop recording' : 'Start recording'}
          className={`flex size-12 items-center justify-center rounded-full text-white transition ${
            status === 'listening'
              ? 'animate-pulse bg-red-500'
              : isBusy
                ? 'cursor-not-allowed bg-slate-300'
                : 'bg-indigo-600 hover:bg-indigo-700'
          }`}
        >
          {isBusy ? <Loader2 className="size-5 animate-spin" /> : <Mic className="size-5" />}
        </button>
      </div>
    </div>
  )
}

type AppState = 'idle' | 'analyzing' | 'results' | 'practice' | 'exercises'
type Difficulty = 'easy' | 'medium' | 'hard'
type Exercise = { number: number; question: string; answer: string; skill: string; solution?: string }

const subjects = ['Math', 'Science', 'Writing', 'Other']
type Mistake = { step?: string; issue: string; correction: string; explanation: string }
type Analysis = {
  subject?: string
  topic?: string
  isCorrect?: boolean
  unclear?: boolean
  mistakes?: Mistake[]
  correctSolution?: string[]
  knowledgeGaps?: string[]
  encouragement?: string
  task?: string
}

export default function Page() {
  const inputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState('')
  const [subject, setSubject] = useState('Math')
  const [appState, setAppState] = useState<AppState>('idle')
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState('')
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [reviewHistory, setReviewHistory] = useState<Record<string, Exercise[]>>({})

  const addToHistory = (exercises: Exercise[]) => {
    const topic = analysis?.topic?.trim() || analysis?.subject || subject
    setReviewHistory((current) => {
      const existing = current[topic] ?? []
      const seen = new Set(existing.map((item) => item.question))
      const fresh = exercises.filter((item) => !seen.has(item.question))
      if (fresh.length === 0) return current
      return { ...current, [topic]: [...existing, ...fresh] }
    })
  }

  useEffect(() => {
    if (!preview) return
    return () => URL.revokeObjectURL(preview)
  }, [preview])

  const chooseFile = (nextFile?: File) => {
    if (!nextFile) {
      setFile(null)
      setPreview('')
      return
    }
    if (!nextFile.type.startsWith('image/')) {
      setError('Please choose an image file (JPG or PNG).')
      return
    }
    setFile(nextFile)
    setPreview(URL.createObjectURL(nextFile))
    setAppState('idle')
    setError('')
  }

  const submit = async () => {
    if (!file) return
    setAppState('analyzing')
    setError('')
    try {
      const { docId, imageBase64, imageMimeType } = await uploadHomeworkImage(file, subject)
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId, imageBase64, imageMimeType, subject }),
      })
      const data = await readJson<Analysis>(response)
      if (!response.ok || !data || data.error) throw new Error(data?.error ?? 'Unable to analyze this submission')
      setAnalysis(data)
      setAppState('results')
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Something went wrong. Please try again.')
      setAppState('idle')
    }
  }

  const reset = () => {
    setFile(null)
    setPreview('')
    setAppState('idle')
    setError('')
    setAnalysis(null)
  }
  const showResults = appState === 'results' || appState === 'practice' || appState === 'exercises'

  return (
    <main className="min-h-screen bg-[#f9fafb] text-slate-900 print:bg-white">
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 lg:px-8">
          <div className="flex items-center gap-3">
            <div
              className="relative flex size-10 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm"
              aria-label="StudyBuddy logo"
            >
              <BookOpen className="size-5" />
              <Sparkles className="absolute -right-1 -top-1 size-3.5 text-amber-300" />
            </div>
            <div>
              <p className="text-lg font-bold tracking-tight">
                StudyBuddy <span className="text-indigo-600">AI</span>
              </p>
              <p className="text-xs text-slate-500">Your homework, understood.</p>
            </div>
          </div>
          {showResults && (
            <Button variant="ghost" onClick={reset}>
              <RotateCcw className="mr-2 size-4" />
              New problem
            </Button>
          )}
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-5 py-10 lg:px-8 lg:py-14">
        {appState === 'idle' && (
          <UploadState
            inputRef={inputRef}
            cameraInputRef={cameraInputRef}
            file={file}
            preview={preview}
            subject={subject}
            setSubject={setSubject}
            isDragging={isDragging}
            setIsDragging={setIsDragging}
            chooseFile={chooseFile}
            submit={submit}
            error={error}
          />
        )}
        {appState === 'idle' && <ReviewTopicsPanel history={reviewHistory} />}
        {appState === 'analyzing' && <LoadingState preview={preview} />}
        {appState === 'results' && (
          <ResultsState
            preview={preview}
            analysis={analysis}
            onPractice={() => setAppState('practice')}
            onExercises={() => setAppState('exercises')}
          />
        )}
        {appState === 'practice' && (
          <PracticeState
            analysis={analysis}
            fallbackSubject={subject}
            onBack={() => setAppState('results')}
            onGenerated={addToHistory}
          />
        )}
        {appState === 'exercises' && (
          <ExerciseSheet analysis={analysis} fallbackSubject={subject} onBack={() => setAppState('results')} />
        )}
      </div>
    </main>
  )
}

function UploadState({
  inputRef,
  cameraInputRef,
  file,
  preview,
  subject,
  setSubject,
  isDragging,
  setIsDragging,
  chooseFile,
  submit,
  error,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>
  cameraInputRef: React.RefObject<HTMLInputElement | null>
  file: File | null
  preview: string
  subject: string
  setSubject: (subject: string) => void
  isDragging: boolean
  setIsDragging: (dragging: boolean) => void
  chooseFile: (file?: File) => void
  submit: () => void
  error: string
}) {
  return (
    <section className="mx-auto max-w-3xl text-center">
      <div className="mb-10">
        <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600">
          <Sparkles className="size-7" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Let&apos;s figure this out together.</h1>
        <p className="mx-auto mt-3 max-w-xl text-base leading-7 text-slate-500">
          Upload a photo of your homework and I&apos;ll help you find mistakes, understand the why, and build your
          confidence.
        </p>
      </div>
      <div
        className={`rounded-3xl border-2 border-dashed bg-white p-5 shadow-sm transition-colors sm:p-8 ${isDragging ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300'}`}
        onDragOver={(event) => {
          event.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setIsDragging(false)
          chooseFile(event.dataTransfer.files[0])
        }}
      >
        {preview ? (
          <div className="relative overflow-hidden rounded-2xl bg-slate-100">
            <img src={preview} alt="Selected homework" className="mx-auto max-h-80 w-full object-contain" />
            <button
              onClick={() => chooseFile()}
              aria-label="Remove selected image"
              className="absolute right-3 top-3 rounded-full bg-white p-2 text-slate-600 shadow hover:text-red-600"
            >
              <X className="size-4" />
            </button>
          </div>
        ) : (
          <div className="flex min-h-56 flex-col items-center justify-center">
            <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-slate-100 text-slate-500">
              <Upload className="size-6" />
            </div>
            <p className="font-semibold">Drop your homework here</p>
            <p className="mt-1 text-sm text-slate-500">or choose an image from your device</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Button variant="outline" onClick={() => inputRef.current?.click()}>
                <FileImage className="mr-2 size-4" />
                Choose photo
              </Button>
              <Button variant="outline" onClick={() => cameraInputRef.current?.click()}>
                <Camera className="mr-2 size-4" />
                Take a photo
              </Button>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => chooseFile(event.target.files?.[0])}
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => chooseFile(event.target.files?.[0])}
            />
          </div>
        )}
      </div>
      <div className="mt-6 text-left">
        <p className="mb-3 text-sm font-semibold text-slate-700">What are you working on?</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {subjects.map((item: string) => (
            <button
              key={item}
              onClick={() => setSubject(item)}
              className={`rounded-xl border px-4 py-3 text-sm font-medium transition ${subject === item ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-300'}`}
            >
              {item}
              {subject === item && <Check className="ml-2 inline size-4" />}
            </button>
          ))}
        </div>
      </div>
      <Button
        size="lg"
        disabled={!file}
        onClick={submit}
        className="mt-8 h-12 w-full rounded-xl bg-indigo-600 text-base text-white shadow-lg shadow-indigo-200 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 sm:w-72"
      >
        Check My Work
        <ChevronRight className="ml-2 size-5" />
      </Button>
      {error && (
        <p role="alert" className="mt-4 text-sm text-red-600">
          {error}
        </p>
      )}
    </section>
  )
}

function LoadingState({ preview }: { preview: string }) {
  return (
    <section className="mx-auto max-w-2xl text-center">
      <h1 className="text-2xl font-bold">One moment, I&apos;m looking closely.</h1>
      <p className="mt-2 text-slate-500">Gemma 4 is reviewing your work...</p>
      <div className="relative mt-8 overflow-hidden rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
        <img src={preview} alt="Homework being reviewed" className="max-h-[28rem] w-full rounded-2xl object-contain" />
        <div className="absolute inset-3 animate-pulse rounded-2xl bg-indigo-600/20" />
      </div>
      <div className="mx-auto mt-7 h-2 max-w-md overflow-hidden rounded-full bg-indigo-100">
        <div className="h-full w-2/3 animate-[progress_1.8s_ease-in-out_infinite] rounded-full bg-indigo-600" />
      </div>
    </section>
  )
}

function ResultsState({
  preview,
  analysis,
  onPractice,
  onExercises,
}: {
  preview: string
  analysis: Analysis | null
  onPractice: () => void
  onExercises: () => void
}) {
  const [speakingItem, setSpeakingItem] = useState<string | null>(null)
  const mistakes = analysis?.mistakes ?? []
  const steps = analysis?.correctSolution ?? []
  const gaps = analysis?.knowledgeGaps ?? []
  const summary =
    analysis?.encouragement ||
    (analysis?.isCorrect ? 'Great work! Your solution looks correct.' : 'Here is some feedback on your work.')
  const voiceContext =
    [
      analysis?.topic && `Topic: ${analysis.topic}`,
      mistakes.length > 0 && `Mistakes: ${mistakes.map((item) => item.issue).join('; ')}`,
      gaps.length > 0 && `Knowledge gaps: ${gaps.join(', ')}`,
    ]
      .filter(Boolean)
      .join('. ') || 'The student just had their homework reviewed'
  return (
    <section>
      <div className="mb-8 flex items-end justify-between">
        <div>
          <p className="text-sm font-semibold text-indigo-600">Review complete</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Here&apos;s what I noticed.</h1>
        </div>
        <span className="hidden rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 sm:inline-flex">
          Ready to learn
        </span>
      </div>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="lg:sticky lg:top-6 lg:self-start">
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
            <img src={preview} alt="Uploaded homework" className="max-h-[600px] w-full rounded-2xl object-contain" />
          </div>
          <p className="mt-3 flex items-center justify-center gap-2 text-xs text-slate-400">
            <Lightbulb className="size-3.5" />
            Learning happens one step at a time.
          </p>
        </div>
        <div className="flex flex-col gap-5">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <p className="text-sm font-semibold text-amber-900">Quick summary</p>
            <p className="mt-1 leading-6 text-amber-900/80">{summary}</p>
            {analysis?.topic && (
              <p className="mt-2 text-xs font-medium text-amber-900/60">
                {analysis.subject ? `${analysis.subject} · ` : ''}
                {analysis.topic}
              </p>
            )}
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-bold">Let&apos;s make it clearer</h2>
              <span className="text-xs font-medium text-slate-400">
                {mistakes.length} {mistakes.length === 1 ? 'thing' : 'things'} to review
              </span>
            </div>
            <div className="flex flex-col gap-4">
              {mistakes.length === 0 && (
                <p className="rounded-xl bg-emerald-50 p-4 text-sm font-medium text-emerald-700">
                  {analysis?.unclear
                    ? 'I could not read this clearly. Try a sharper, well-lit photo.'
                    : 'No mistakes found. Nice job!'}
                </p>
              )}
              {mistakes.map((item, index) => (
                <article
                  key={`${index}-${item.issue}`}
                  className="rounded-xl border border-slate-200 border-l-4 border-l-red-400 bg-slate-50/70 p-4"
                >
                  {item.step && <p className="mb-2 font-mono text-xs text-slate-500">{item.step}</p>}
                  <p className="text-sm">
                    <span className="font-semibold text-red-600">Mistake</span>
                    <span className="mx-2 text-slate-300">|</span>
                    {item.issue}
                  </p>
                  <p className="mt-2 text-sm">
                    <span className="font-semibold text-emerald-600">Try this</span>
                    <span className="mx-2 text-slate-300">|</span>
                    {item.correction}
                  </p>
                  <p className="mt-3 text-sm leading-6 text-slate-500">{item.explanation}</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={speakingItem !== null}
                    onClick={async () => {
                      setSpeakingItem(item.issue)
                      await speak(`${item.correction}. ${item.explanation}`)
                      setSpeakingItem(null)
                    }}
                    className="mt-2 px-0 text-indigo-600 hover:bg-transparent hover:text-indigo-700"
                  >
                    <Speaker className="mr-2 size-4" />
                    {speakingItem === item.issue ? 'Playing...' : 'Hear explanation'}
                  </Button>
                </article>
              ))}
            </div>
            {gaps.length > 0 && (
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-500">Focus areas:</span>
                {gaps.map((gap) => (
                  <span key={gap} className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">
                    {gap}
                  </span>
                ))}
              </div>
            )}
          </div>
          {steps.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 font-bold">Correct approach</h2>
              <ol className="flex flex-col gap-2">
                {steps.map((step, index) => (
                  <li key={`${index}-${step}`} className="flex items-start gap-3 text-sm">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-semibold text-emerald-700">
                      {index + 1}
                    </span>
                    <span className="pt-0.5 font-mono text-slate-700">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              onClick={onPractice}
              className="h-12 flex-1 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700"
            >
              Practice Now
              <ChevronRight className="ml-2 size-5" />
            </Button>
            <Button
              onClick={onExercises}
              variant="outline"
              className="h-12 flex-1 rounded-xl border-indigo-300 text-indigo-700 hover:bg-indigo-50"
            >
              Generate Exercise Sheet
              <ChevronRight className="ml-2 size-5" />
            </Button>
          </div>
        </div>
      </div>
      <VoiceChat subject={analysis?.subject ?? 'Math'} context={voiceContext} />
    </section>
  )
}

function normalizeAnswer(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/^[a-z]=/, '')
    .replace(/\.$/, '')
}

function isAnswerCorrect(studentAnswer: string, expectedAnswer: string) {
  const student = normalizeAnswer(studentAnswer)
  if (!student) return false
  const expected = normalizeAnswer(expectedAnswer)
  if (student === expected) return true
  const studentNumber = Number(student)
  const expectedNumber = Number(expected)
  return Number.isFinite(studentNumber) && Number.isFinite(expectedNumber) && studentNumber === expectedNumber
}

type ExerciseRequest = {
  subject: string
  topic: string
  weakness: string
  originalTask?: string
  mistakes: string[]
  difficulty: Difficulty
  count: number
  avoid: string[]
}

function exerciseRequestFor(analysis: Analysis | null, fallbackSubject: string) {
  return {
    subject: analysis?.subject ?? fallbackSubject,
    topic: analysis?.topic ?? 'General',
    weakness: analysis?.knowledgeGaps?.[0] ?? analysis?.topic ?? 'General practice',
    originalTask: analysis?.task,
    mistakes: analysis?.mistakes?.map((item) => item.issue) ?? [],
  }
}

async function fetchExercises(request: ExerciseRequest) {
  const response = await fetch('/api/exercises', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  const data = await readJson<{ exercises?: Exercise[] }>(response)
  if (!response.ok || !Array.isArray(data?.exercises) || data.exercises.length === 0) {
    throw new Error(data?.error ?? 'Unable to create exercises. Please try again.')
  }
  return data.exercises
}

const PRACTICE_BATCH_SIZE = 3

function PracticeState({
  analysis,
  fallbackSubject,
  onBack,
  onGenerated,
}: {
  analysis: Analysis | null
  fallbackSubject: string
  onBack: () => void
  onGenerated: (exercises: Exercise[]) => void
}) {
  const baseRequest = exerciseRequestFor(analysis, fallbackSubject)
  const avoidOriginal = baseRequest.originalTask ? [baseRequest.originalTask] : []
  const {
    data: firstBatch,
    error: firstBatchError,
    isLoading: firstBatchLoading,
    mutate: retryFirstBatch,
  } = useSWRImmutable(
    ['practice', baseRequest.originalTask ?? baseRequest.topic, baseRequest.weakness],
    () => fetchExercises({ ...baseRequest, difficulty: 'medium', count: PRACTICE_BATCH_SIZE, avoid: avoidOriginal }),
    { onSuccess: onGenerated },
  )
  const [extraProblems, setExtraProblems] = useState<Exercise[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState('')
  const [index, setIndex] = useState(0)
  const [answer, setAnswer] = useState('')
  const [checked, setChecked] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const problems = [...(firstBatch ?? []), ...extraProblems]
  const problem = problems[index]
  const subject = analysis?.subject ?? fallbackSubject
  const correct = problem ? isAnswerCorrect(answer, problem.answer) : false

  const checkAnswer = () => {
    if (!problem || !answer.trim()) return
    setChecked(true)
    speak(correct ? 'Correct! Great work!' : 'Not quite. Take another look and try again.')
  }

  const goTo = (nextIndex: number) => {
    setIndex(nextIndex)
    setAnswer('')
    setChecked(false)
    setRevealed(false)
  }

  const nextProblem = async () => {
    if (index + 1 < problems.length) {
      goTo(index + 1)
      return
    }
    setLoadingMore(true)
    setMoreError('')
    try {
      const fresh = await fetchExercises({
        ...baseRequest,
        difficulty: 'medium',
        count: PRACTICE_BATCH_SIZE,
        avoid: [...avoidOriginal, ...problems.map((item) => item.question)],
      })
      setExtraProblems((current) => [...current, ...fresh])
      onGenerated(fresh)
      goTo(index + 1)
    } catch (loadError) {
      setMoreError(loadError instanceof Error ? loadError.message : 'Unable to create a new problem.')
    } finally {
      setLoadingMore(false)
    }
  }

  const backButton = (
    <button
      onClick={onBack}
      className="mb-8 flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-indigo-600 print:hidden"
    >
      <ChevronLeft className="size-4" />
      Back to Results
    </button>
  )

  if (!problem) {
    return (
      <section className="mx-auto max-w-2xl">
        {backButton}
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          {firstBatchLoading || !firstBatchError ? (
            <div role="status" className="flex flex-col items-center gap-3 text-slate-500">
              <Loader2 className="size-6 animate-spin text-indigo-600" />
              <p className="font-medium">Gemma 4 is writing new problems based on your task...</p>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold">Could not create practice problems.</h1>
              <p role="alert" className="mt-2 text-slate-500">
                {firstBatchError instanceof Error ? firstBatchError.message : 'Please try again.'}
              </p>
              <Button
                onClick={() => retryFirstBatch()}
                className="mt-6 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700"
              >
                Try again
              </Button>
            </>
          )}
        </div>
      </section>
    )
  }

  return (
    <section className="mx-auto max-w-2xl">
      {backButton}
      <p className="text-sm font-semibold text-indigo-600">Practice time</p>
      <h1 className="mt-1 text-3xl font-bold">Try a similar problem.</h1>
      {analysis?.task && (
        <p className="mt-2 text-sm text-slate-500">
          <span className="font-semibold">Based on:</span> {analysis.task}
        </p>
      )}
      <div className="mt-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex items-center justify-between text-sm font-medium text-slate-500">
          <span>{problem.skill || 'Practice problem'}</span>
          <span>Problem {index + 1}</span>
        </div>
        <p className="mt-4 text-2xl font-semibold leading-relaxed">{problem.question}</p>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            checkAnswer()
          }}
        >
          <label className="mt-8 block text-sm font-semibold" htmlFor="practice-answer">
            Your answer
          </label>
          <input
            id="practice-answer"
            value={answer}
            onChange={(event) => {
              setAnswer(event.target.value)
              setChecked(false)
            }}
            className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            placeholder="Type your answer"
            autoComplete="off"
          />
          <Button
            type="submit"
            disabled={!answer.trim()}
            className="mt-4 w-full rounded-xl bg-indigo-600 text-white hover:bg-indigo-700"
          >
            Check answer
          </Button>
        </form>
        {checked && (
          <p
            role="status"
            className={`mt-4 rounded-xl p-4 text-sm font-medium ${correct ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}
          >
            {correct ? 'Correct. Great work!' : 'Not quite. Take another look and try again.'}
          </p>
        )}
        {revealed && (
          <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
            <span className="font-semibold">Answer:</span> {problem.answer}
            {problem.solution && <span className="mt-2 block whitespace-pre-line text-slate-600">{problem.solution}</span>}
          </p>
        )}
        <div className="mt-4 flex gap-3">
          {index > 0 && (
            <Button variant="outline" className="rounded-xl" onClick={() => goTo(index - 1)} disabled={loadingMore}>
              <ChevronLeft className="size-4" />
              <span className="sr-only">Previous problem</span>
            </Button>
          )}
          <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setRevealed(true)} disabled={revealed}>
            Show answer
          </Button>
          <Button variant="outline" className="flex-1 rounded-xl" onClick={nextProblem} disabled={loadingMore}>
            {loadingMore ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                Next problem
                <ChevronRight className="ml-2 size-4" />
              </>
            )}
          </Button>
        </div>
        {moreError && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {moreError}
          </p>
        )}
      </div>
      <TopicList problems={problems} currentIndex={index} onSelect={goTo} />
      <VoiceChat subject={subject} context={`The student is practicing this problem: ${problem.question}`} />
    </section>
  )
}

function TopicList({
  problems,
  currentIndex,
  onSelect,
}: {
  problems: Exercise[]
  currentIndex: number
  onSelect: (index: number) => void
}) {
  const [openTopics, setOpenTopics] = useState<Record<string, boolean>>({})
  const topics = new Map<string, { problem: Exercise; index: number }[]>()
  problems.forEach((problem, index) => {
    const topic = problem.skill?.trim() || 'Practice problem'
    topics.set(topic, [...(topics.get(topic) ?? []), { problem, index }])
  })

  return (
    <nav aria-label="Review by topic" className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-bold">Review by topic</h2>
        <span className="text-xs font-medium text-slate-400">
          {problems.length} {problems.length === 1 ? 'problem' : 'problems'} generated
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {[...topics.entries()].map(([topic, items]) => {
          const isOpen = openTopics[topic] ?? false
          const panelId = `topic-${topic.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`
          const containsCurrent = items.some((item) => item.index === currentIndex)
          return (
            <li key={topic} className="overflow-hidden rounded-xl border border-slate-200">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setOpenTopics((current) => ({ ...current, [topic]: !isOpen }))}
                className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold transition hover:bg-slate-50 ${containsCurrent ? 'text-indigo-700' : 'text-slate-700'}`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <ChevronRight className={`size-4 shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                  <span className="truncate">{topic}</span>
                </span>
                <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                  {items.length}
                </span>
              </button>
              {isOpen && (
                <ul id={panelId} className="flex flex-col gap-1 border-t border-slate-100 bg-slate-50/60 p-2">
                  {items.map(({ problem, index }) => {
                    const isCurrent = index === currentIndex
                    return (
                      <li key={`${index}-${problem.question}`}>
                        <button
                          type="button"
                          onClick={() => onSelect(index)}
                          aria-current={isCurrent ? 'step' : undefined}
                          className={`flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${isCurrent ? 'bg-indigo-600 text-white' : 'text-slate-700 hover:bg-white'}`}
                        >
                          <span
                            className={`shrink-0 text-xs font-semibold ${isCurrent ? 'text-indigo-100' : 'text-slate-400'}`}
                          >
                            #{index + 1}
                          </span>
                          <span className="line-clamp-2">{problem.question}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

function ReviewTopicsPanel({ history }: { history: Record<string, Exercise[]> }) {
  const [openTopics, setOpenTopics] = useState<Record<string, boolean>>({})
  const [openAnswers, setOpenAnswers] = useState<Record<string, boolean>>({})
  const topics = Object.entries(history)
  const total = topics.reduce((sum, [, items]) => sum + items.length, 0)

  return (
    <nav
      aria-label="Review by topic"
      className="mx-auto mt-10 max-w-3xl rounded-3xl border border-slate-200 bg-white p-5 text-left shadow-sm sm:p-6"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-bold">Review by topic</h2>
          <p className="text-sm text-slate-500">Every practice problem you generated, grouped by topic.</p>
        </div>
        <span className="shrink-0 text-xs font-medium text-slate-400">
          {total} {total === 1 ? 'problem' : 'problems'}
        </span>
      </div>
      {topics.length === 0 ? (
        <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
          No topics yet. Upload homework and use Practice Now — every problem you generate with Next problem will
          appear here.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {topics.map(([topic, items]) => {
            const isOpen = openTopics[topic] ?? false
            const panelId = `review-${topic.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`
            return (
              <li key={topic} className="overflow-hidden rounded-xl border border-slate-200">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => setOpenTopics((current) => ({ ...current, [topic]: !isOpen }))}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <ChevronRight className={`size-4 shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                    <span className="truncate">{topic}</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                    {items.length}
                  </span>
                </button>
                {isOpen && (
                  <ol id={panelId} className="flex flex-col gap-2 border-t border-slate-100 bg-slate-50/60 p-3">
                    {items.map((problem, index) => {
                      const answerKey = `${topic}-${index}`
                      const showAnswer = openAnswers[answerKey] ?? false
                      return (
                        <li key={answerKey} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
                          <div className="flex items-start gap-3">
                            <span className="shrink-0 text-xs font-semibold text-slate-400">#{index + 1}</span>
                            <div className="min-w-0 flex-1">
                              {problem.skill && (
                                <p className="mb-1 text-xs font-medium text-indigo-600">{problem.skill}</p>
                              )}
                              <p className="font-medium leading-6 text-slate-800">{problem.question}</p>
                              <button
                                type="button"
                                aria-expanded={showAnswer}
                                onClick={() => setOpenAnswers((current) => ({ ...current, [answerKey]: !showAnswer }))}
                                className="mt-2 text-xs font-semibold text-indigo-600 hover:text-indigo-700"
                              >
                                {showAnswer ? 'Hide answer' : 'Show answer'}
                              </button>
                              {showAnswer && (
                                <p className="mt-2 rounded-lg bg-slate-50 p-3 text-slate-700">
                                  <span className="font-semibold">Answer:</span> {problem.answer}
                                  {problem.solution && (
                                    <span className="mt-2 block whitespace-pre-line text-slate-600">
                                      {problem.solution}
                                    </span>
                                  )}
                                </p>
                              )}
                            </div>
                          </div>
                        </li>
                      )
                    })}
                  </ol>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </nav>
  )
}

function ExerciseSheet({
  analysis,
  fallbackSubject,
  onBack,
}: {
  analysis: Analysis | null
  fallbackSubject: string
  onBack: () => void
}) {
  const weakness = analysis?.knowledgeGaps?.[0] ?? analysis?.topic ?? 'General practice'
  const [difficulty, setDifficulty] = useState<Difficulty>('medium')
  const [state, setState] = useState<'idle' | 'loading' | 'ready'>('idle')
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [openAnswers, setOpenAnswers] = useState<Record<number, boolean>>({})
  const [error, setError] = useState('')
  const generate = async () => {
    setState('loading')
    setError('')
    setOpenAnswers({})
    try {
      const fresh = await fetchExercises({
        ...exerciseRequestFor(analysis, fallbackSubject),
        difficulty,
        count: 5,
        avoid: [...(analysis?.task ? [analysis.task] : []), ...exercises.map((item) => item.question)],
      })
      setExercises(fresh)
      setState('ready')
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : 'Unable to create exercises.')
      setState('idle')
    }
  }
  return (
    <section className="mx-auto max-w-4xl">
      <button
        onClick={onBack}
        className="mb-6 flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-indigo-600 print:hidden"
      >
        <ChevronLeft className="size-4" />
        Back to Results
      </button>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-indigo-600">Personalized practice</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Exercise Sheet</h1>
        </div>
        <span className="w-fit rounded-full bg-amber-100 px-3 py-1.5 text-sm font-semibold text-amber-800">
          Targeted practice for: {weakness}
        </span>
      </div>
      <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold text-slate-700">Choose a difficulty</p>
        <div className="mt-3 flex gap-2">
          {(['easy', 'medium', 'hard'] as Difficulty[]).map((item) => (
            <button
              key={item}
              onClick={() => setDifficulty(item)}
              className={`rounded-full border px-5 py-2 text-sm font-semibold capitalize transition ${difficulty === item ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 text-slate-600 hover:border-indigo-300'}`}
            >
              {item}
            </button>
          ))}
        </div>
        <Button
          onClick={generate}
          disabled={state === 'loading'}
          className="mt-5 h-12 w-full rounded-xl bg-indigo-600 text-base text-white shadow-lg shadow-indigo-100 hover:bg-indigo-700"
        >
          {state === 'loading' ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Creating exercises...
            </>
          ) : (
            'Generate Exercises'
          )}
        </Button>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {error}
          </p>
        )}
      </div>
      {state === 'loading' && (
        <div className="flex items-center justify-center gap-3 py-16 text-slate-500">
          <Loader2 className="size-5 animate-spin text-indigo-600" />
          Gemma 4 is creating your exercises...
        </div>
      )}
      {state === 'ready' && (
        <div className="mt-6 flex flex-col gap-4">
          {exercises.map((exercise) => (
            <article
              key={exercise.number}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
            >
              <div className="flex items-start gap-4">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 font-bold text-indigo-700">
                  {exercise.number}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-lg font-semibold leading-8 text-slate-900">{exercise.question}</p>
                  <span className="mt-3 inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                    {exercise.skill}
                  </span>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <button
                      onClick={() =>
                        setOpenAnswers((current) => ({ ...current, [exercise.number]: !current[exercise.number] }))
                      }
                      className="text-sm font-semibold text-indigo-600 hover:text-indigo-800"
                    >
                      {openAnswers[exercise.number] ? 'Hide Answer' : 'Show Answer'}
                    </button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="voice-button print:hidden"
                      onClick={() => speak(exercise.question)}
                    >
                      <Speaker className="mr-2 size-4" />
                      Read Question
                    </Button>
                  </div>
                  <div
                    className={`answer-reveal mt-4 rounded-xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-700 ${openAnswers[exercise.number] ? '' : 'hidden print:block'}`}
                  >
                    Answer: {exercise.answer}
                    {exercise.solution && (
                      <span className="mt-2 block whitespace-pre-line font-normal text-emerald-800">{exercise.solution}</span>
                    )}
                  </div>
                </div>
              </div>
            </article>
          ))}
          <Button
            variant="outline"
            onClick={() => window.print()}
            className="mt-3 h-12 border-indigo-300 text-indigo-700 hover:bg-indigo-50 print:hidden"
          >
            Print / Save as PDF
          </Button>
        </div>
      )}
      <VoiceChat
        subject={analysis?.subject ?? fallbackSubject}
        context={`The student is working through practice exercises on ${weakness}`}
      />
    </section>
  )
}
