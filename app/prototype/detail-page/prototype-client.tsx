"use client";

// THROWAWAY PROTOTYPE: three detail-page directions, switchable with ?variant=A|B|C.

import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  ChevronRight,
  FileText,
  Flag,
  Flame,
  GraduationCap,
  ImageIcon,
  LogIn,
  LogOut,
  MessageSquareText,
  Paperclip,
  Pencil,
  Plus,
  Send,
  ThumbsDown,
  ThumbsUp,
  UserRound,
  X,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type Variant = "A" | "B" | "C";
type Entity = "course" | "instructor" | "class";
type Vote = "up" | "down" | null;
type Review = {
  id: number;
  author: string;
  hidden: boolean;
  date: string;
  bases: string[];
  context?: string;
  body: string;
  image?: boolean;
  document?: string;
  mine?: boolean;
};

const variants: Array<{ key: Variant; name: string }> = [
  { key: "A", name: "Evidence first" },
  { key: "B", name: "Workspace" },
  { key: "C", name: "Community journal" },
];

const entities: Record<
  Entity,
  { eyebrow: string; title: string; subtitle: string; rank: string; grade: string }
> = {
  course: {
    eyebrow: "Course",
    title: "COMP 2011",
    subtitle: "Object-Oriented Programming",
    rank: "Global #18 of 642",
    grade: "A−",
  },
  instructor: {
    eyebrow: "Instructor",
    title: "Desmond Lee",
    subtitle: "Teaching COMP 2011 · COMP 1021",
    rank: "Global #27 of 518",
    grade: "B+",
  },
  class: {
    eyebrow: "Class",
    title: "COMP 2011 · L1",
    subtitle: "2025-26 Fall · Desmond Lee",
    rank: "Course #18 · Instructor #27",
    grade: "A−",
  },
};

const reviews: Review[] = [
  {
    id: 1,
    author: "mapleleaf",
    hidden: false,
    date: "12 days ago",
    bases: ["Course · COMP 2011", "Instructor · Desmond Lee"],
    context: "2025-26 Fall · L1",
    body: "The examples build on each other well, especially once inheritance starts. **Do the labs before the tutorial**—the pace gets quick after midterm.",
    image: true,
    document: "revision-notes.pdf",
    mine: true,
  },
  {
    id: 2,
    author: "Identity hidden",
    hidden: true,
    date: "3 weeks ago",
    bases: ["Course · COMP 2011"],
    body: "A solid introduction to OOP, but the project specification left several edge cases open. Workload was manageable in a four-course term.",
  },
  {
    id: 3,
    author: "cobalt",
    hidden: false,
    date: "2 months ago",
    bases: ["Instructor · Desmond Lee"],
    context: "2024-25 Spring",
    body: "Questions were welcomed and usually answered with a second example. Office hours helped more than rereading the slides.",
  },
];

const criteria = [
  ["Content", "8.4", "+0.3"],
  ["Teaching", "8.1", "+0.1"],
  ["Grading", "7.2", "−0.2"],
  ["Workload", "6.8", "+0.4"],
];

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function EntityPicker({ entity, onChange }: { entity: Entity; onChange: (entity: Entity) => void }) {
  return (
    <div className="inline-flex rounded-full border border-slate-200 bg-white p-1 shadow-sm" aria-label="Prototype entity">
      {(["course", "instructor", "class"] as Entity[]).map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          className={cx(
            "rounded-full px-3 py-1.5 text-xs font-semibold capitalize transition",
            value === entity ? "bg-[#003366] text-white" : "text-slate-600 hover:bg-slate-100",
          )}
        >
          {value}
        </button>
      ))}
    </div>
  );
}

function Signals({
  entity,
  signedIn,
  vote,
  setVote,
  reactions,
  toggleReaction,
  compact = false,
}: {
  entity: Entity;
  signedIn: boolean;
  vote: Vote;
  setVote: (vote: Vote) => void;
  reactions: string[];
  toggleReaction: (reaction: string) => void;
  compact?: boolean;
}) {
  if (entity === "class") {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-left text-sm text-slate-600">
        <p className="font-semibold text-slate-800">Signals belong to Review Bases</p>
        <p className="mt-1">React to COMP 2011 or Desmond Lee—not this Class.</p>
        <div className="mt-3 flex gap-2">
          <button className="rounded-full border bg-white px-3 py-1.5 font-medium">Course signals</button>
          <button className="rounded-full border bg-white px-3 py-1.5 font-medium">Instructor signals</button>
        </div>
      </div>
    );
  }

  const reactionChoices = [
    ["love", "❤️", "126"],
    ["laugh", "😂", "31"],
    ["surprised", "😮", "18"],
    ["confused", "😕", "44"],
    ["sad", "😢", "9"],
    ["angry", "😡", "7"],
    ["fire", "🔥", "83"],
  ];

  return (
    <div className={cx("text-left", !compact && "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm")}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Community pulse</p>
          <p className="mt-1 text-sm text-slate-600">Separate from ranking scores</p>
        </div>
        {!signedIn && <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">Sign in to respond</span>}
      </div>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={!signedIn}
          onClick={() => setVote(vote === "up" ? null : "up")}
          className={cx(
            "flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold disabled:opacity-50",
            vote === "up" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-700",
          )}
        >
          <ThumbsUp className="h-4 w-4" /> 214
        </button>
        <button
          type="button"
          disabled={!signedIn}
          onClick={() => setVote(vote === "down" ? null : "down")}
          className={cx(
            "flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold disabled:opacity-50",
            vote === "down" ? "border-rose-300 bg-rose-50 text-rose-800" : "border-slate-200 bg-white text-slate-700",
          )}
        >
          <ThumbsDown className="h-4 w-4" /> 39
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {reactionChoices.map(([key, emoji, count]) => (
          <button
            key={key}
            type="button"
            disabled={!signedIn}
            aria-pressed={reactions.includes(key)}
            onClick={() => toggleReaction(key)}
            className={cx(
              "rounded-full border px-2.5 py-1 text-sm disabled:opacity-50",
              reactions.includes(key) ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white",
            )}
          >
            {emoji} <span className="text-xs text-slate-500">{count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function BasisBadges({ bases, context }: { bases: string[]; context?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {bases.map((basis) => (
        <span key={basis} className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-900">
          {basis}
        </span>
      ))}
      {context && (
        <span className="flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600">
          <CalendarDays className="h-3 w-3" /> {context}
        </span>
      )}
    </div>
  );
}

function ReviewCard({
  review,
  style = "card",
  onEdit,
  onReport,
  reported,
}: {
  review: Review;
  style?: "card" | "ledger" | "journal";
  onEdit: () => void;
  onReport: () => void;
  reported: boolean;
}) {
  return (
    <article
      className={cx(
        "text-left",
        style === "card" && "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm",
        style === "ledger" && "border-b border-slate-200 px-5 py-6",
        style === "journal" && "border-l-2 border-amber-300 py-2 pl-5",
      )}
    >
      <BasisBadges bases={review.bases} context={review.context} />
      <div className="mt-4 flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold text-slate-900">{review.author}</p>
          <p className="text-xs text-slate-500">{review.date}{review.hidden ? " · identity hidden" : ""}</p>
        </div>
        <div className="flex gap-1">
          {review.mine && (
            <button type="button" onClick={onEdit} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Edit your Review">
              <Pencil className="h-4 w-4" />
            </button>
          )}
          <button type="button" onClick={onReport} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Report Review">
            {reported ? <Check className="h-4 w-4 text-emerald-600" /> : <Flag className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <p className="mt-4 leading-7 text-slate-700">
        {review.body.split("**").map((part, index) => (index % 2 ? <strong key={index}>{part}</strong> : part))}
      </p>
      {review.image && (
        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-br from-sky-100 via-indigo-50 to-amber-100 p-4">
          <div className="flex aspect-[16/7] items-center justify-center rounded-lg border border-white/80 bg-white/60 font-mono text-sm text-slate-600 shadow-inner">
            <ImageIcon className="mr-2 h-5 w-5" /> Inline Image Attachment · lab diagram
          </div>
        </div>
      )}
      {review.document && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex min-w-0 items-center gap-3">
            <FileText className="h-5 w-5 shrink-0 text-blue-700" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{review.document}</p>
              <p className="text-xs text-amber-700">Not malware-scanned</p>
            </div>
          </div>
          <div className="flex gap-2 text-xs font-semibold">
            <button className="rounded-lg border bg-white px-2.5 py-1.5">Open ↗</button>
            <button className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-white">Download</button>
          </div>
        </div>
      )}
    </article>
  );
}

function Metrics({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cx("grid grid-cols-2 gap-3", !compact && "md:grid-cols-4")}>
      {criteria.map(([name, value, change]) => (
        <div key={name} className={cx("rounded-xl border border-slate-200 bg-white", compact ? "p-3" : "p-4 shadow-sm")}>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{name}</p>
          <div className="mt-1 flex items-end justify-between gap-2">
            <strong className="text-2xl tracking-tight text-slate-900">{value}</strong>
            <span className="text-xs font-medium text-emerald-700">{change}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function TopBar({ signedIn, setSignedIn }: { signedIn: boolean; setSignedIn: (signedIn: boolean) => void }) {
  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-[#003366] text-white shadow-sm">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6">
        <div className="flex items-center gap-2 font-bold tracking-tight">
          <GraduationCap className="h-7 w-7 text-amber-300" />
          <span>UST Rankings</span>
        </div>
        <nav className="ml-auto hidden items-center gap-5 text-sm font-medium md:flex" aria-label="Prototype navigation">
          <span>Rankings</span><span>Courses</span><span>Instructors</span><span>Schedule</span>
        </nav>
        <button
          type="button"
          onClick={() => setSignedIn(!signedIn)}
          className="ml-auto flex items-center gap-2 rounded-full border border-white/30 px-3 py-1.5 text-xs font-semibold md:ml-2"
        >
          {signedIn ? <><UserRound className="h-4 w-4" /> mapleleaf <LogOut className="h-3.5 w-3.5" /></> : <><LogIn className="h-4 w-4" /> Sign in</>}
        </button>
      </div>
    </header>
  );
}

function VariantA({ common }: { common: CommonProps }) {
  const data = entities[common.entity];
  return (
    <div className="min-h-screen bg-slate-50 pb-28">
      <TopBar signedIn={common.signedIn} setSignedIn={common.setSignedIn} />
      <main className="mx-auto max-w-7xl px-4 py-8 text-left sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-slate-500">Rankings <ChevronRight className="inline h-4 w-4" /> {data.eyebrow}</p>
          <EntityPicker entity={common.entity} onChange={common.setEntity} />
        </div>
        <section className="mt-8 grid items-end gap-6 border-b border-slate-200 pb-8 lg:grid-cols-[1fr_auto]">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-700">{data.eyebrow}</p>
            <h1 className="mt-2 text-4xl font-black tracking-tight text-slate-950 sm:text-6xl">{data.title}</h1>
            <p className="mt-2 text-lg text-slate-600">{data.subtitle}</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right"><p className="text-xs uppercase text-slate-400">Learning-focused</p><p className="mt-1 font-semibold">{data.rank}</p></div>
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-600 text-2xl font-black text-white shadow-lg">{data.grade}</div>
          </div>
        </section>

        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-8">
            <section><div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-bold">Ranking evidence</h2><button className="text-sm font-semibold text-blue-700">View trends →</button></div><Metrics /></section>
            <section>
              <div className="mb-4 flex items-end justify-between gap-4"><div><h2 className="text-2xl font-bold">Reviews</h2><p className="text-sm text-slate-500">Experiences connected to this {data.eyebrow.toLowerCase()}</p></div><span className="text-sm font-semibold text-slate-600">18 Reviews</span></div>
              <div className="space-y-4">
                {reviews.map((review) => <ReviewCard key={review.id} review={review} onEdit={common.openComposer} onReport={() => common.setReported(review.id)} reported={common.reported === review.id} />)}
              </div>
            </section>
          </div>
          <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
            <button onClick={common.signedIn ? common.openComposer : () => common.setSignedIn(true)} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#003366] px-5 py-3.5 font-bold text-white shadow-lg shadow-blue-950/10">
              <MessageSquareText className="h-5 w-5" /> {common.signedIn ? "Write or edit your Review" : "Sign in to write"}
            </button>
            <Signals {...common.signalProps} entity={common.entity} />
            <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm shadow-sm"><p className="font-bold">Known associations</p><div className="mt-3 space-y-2 text-slate-600"><p>2025-26 Fall · L1 · Desmond Lee</p><p>2025-26 Fall · L2 · Ada Chan</p><p>2024-25 Spring · L1 · Desmond Lee</p></div></div>
          </aside>
        </div>
      </main>
    </div>
  );
}

function VariantB({ common }: { common: CommonProps }) {
  const data = entities[common.entity];
  return (
    <div className="min-h-screen bg-white pb-28">
      <TopBar signedIn={common.signedIn} setSignedIn={common.setSignedIn} />
      <div className="mx-auto grid max-w-[1500px] lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="border-b bg-slate-950 p-6 text-white lg:min-h-[calc(100vh-4rem)] lg:border-b-0 lg:border-r lg:border-slate-800 lg:p-8">
          <EntityPicker entity={common.entity} onChange={common.setEntity} />
          <p className="mt-9 text-xs font-bold uppercase tracking-[0.2em] text-cyan-300">{data.eyebrow}</p>
          <h1 className="mt-2 text-4xl font-black tracking-tight">{data.title}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-300">{data.subtitle}</p>
          <div className="mt-7 flex items-center gap-3 border-y border-slate-800 py-5">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-emerald-500 text-xl font-black">{data.grade}</div>
            <div><p className="text-xs text-slate-400">Learning-focused</p><p className="font-semibold">{data.rank}</p></div>
          </div>
          <nav className="mt-6 space-y-1 text-sm" aria-label="Detail sections">
            {["Overview", "Ranking evidence", "Classes & associations", "Reviews · 18"].map((item, index) => <button key={item} className={cx("flex w-full items-center justify-between rounded-lg px-3 py-2 text-left", index === 3 ? "bg-white/10 font-semibold text-white" : "text-slate-300 hover:bg-white/5")}><span>{item}</span><ChevronRight className="h-4 w-4" /></button>)}
          </nav>
          <div className="mt-7 rounded-xl bg-white/5 p-4"><Signals {...common.signalProps} entity={common.entity} compact /></div>
        </aside>

        <main className="min-w-0 text-left">
          <div className="border-b border-slate-200 p-5 sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-widest text-slate-400">Evidence snapshot</p><h2 className="mt-1 text-xl font-bold">How this entity is doing</h2></div><button className="rounded-lg border px-3 py-2 text-sm font-semibold">2025-26 Fall ▾</button></div>
            <div className="mt-5"><Metrics /></div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-slate-50 px-5 py-4 sm:px-8">
            <div><h2 className="text-xl font-bold">Review ledger</h2><p className="text-xs text-slate-500">Filter by Basis or Context without duplicating Reviews</p></div>
            <div className="flex gap-2"><button className="rounded-lg border bg-white px-3 py-2 text-sm font-medium">All contexts ▾</button><button onClick={common.signedIn ? common.openComposer : () => common.setSignedIn(true)} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white">{common.signedIn ? "+ Review" : "Sign in"}</button></div>
          </div>
          <div className="divide-y divide-slate-200">
            {reviews.map((review) => <ReviewCard key={review.id} review={review} style="ledger" onEdit={common.openComposer} onReport={() => common.setReported(review.id)} reported={common.reported === review.id} />)}
          </div>
        </main>
      </div>
    </div>
  );
}

function VariantC({ common }: { common: CommonProps }) {
  const data = entities[common.entity];
  return (
    <div className="min-h-screen bg-[#fbf7ed] pb-28 text-slate-900">
      <TopBar signedIn={common.signedIn} setSignedIn={common.setSignedIn} />
      <main className="mx-auto max-w-5xl px-4 py-7 text-left sm:px-6 sm:py-12">
        <div className="flex justify-center"><EntityPicker entity={common.entity} onChange={common.setEntity} /></div>
        <header className="mx-auto mt-10 max-w-3xl text-center">
          <p className="font-mono text-xs font-bold uppercase tracking-[0.24em] text-amber-700">{data.eyebrow} field notes</p>
          <h1 className="mt-3 font-serif text-5xl font-black tracking-tight sm:text-7xl">{data.title}</h1>
          <p className="mt-3 text-lg text-slate-600">{data.subtitle}</p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3"><span className="rounded-full bg-slate-900 px-4 py-2 text-sm font-bold text-white">{data.grade} · {data.rank}</span><span className="rounded-full border border-amber-300 bg-amber-50 px-4 py-2 text-sm">Learning-focused preset</span></div>
        </header>

        <section className="mt-10 rounded-[2rem] border border-amber-200 bg-white/70 p-5 shadow-sm sm:p-7">
          <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr] lg:items-center">
            <Metrics compact />
            <div className="border-t border-amber-200 pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0"><Signals {...common.signalProps} entity={common.entity} compact /></div>
          </div>
        </section>

        <section className="mx-auto mt-14 max-w-3xl">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-slate-900 pb-4"><div><p className="font-mono text-xs uppercase tracking-widest text-amber-700">The community record</p><h2 className="mt-1 font-serif text-4xl font-black">18 Reviews</h2></div><button onClick={common.signedIn ? common.openComposer : () => common.setSignedIn(true)} className="flex items-center gap-2 rounded-full bg-amber-400 px-5 py-3 text-sm font-black text-slate-950 shadow-sm"><Pencil className="h-4 w-4" /> {common.signedIn ? "Add your experience" : "Sign in to write"}</button></div>
          <div className="mt-8 space-y-9">
            {reviews.map((review) => <ReviewCard key={review.id} review={review} style="journal" onEdit={common.openComposer} onReport={() => common.setReported(review.id)} reported={common.reported === review.id} />)}
          </div>
        </section>
      </main>
    </div>
  );
}

type CommonProps = {
  entity: Entity;
  setEntity: (entity: Entity) => void;
  signedIn: boolean;
  setSignedIn: (value: boolean) => void;
  openComposer: () => void;
  reported: number | null;
  setReported: (id: number) => void;
  signalProps: {
    signedIn: boolean;
    vote: Vote;
    setVote: (vote: Vote) => void;
    reactions: string[];
    toggleReaction: (reaction: string) => void;
  };
};

function Composer({ onClose, onPublish }: { onClose: () => void; onPublish: () => void }) {
  const [courseBasis, setCourseBasis] = useState(true);
  const [instructorBasis, setInstructorBasis] = useState(true);
  const [identityHidden, setIdentityHidden] = useState(false);
  const [preview, setPreview] = useState(false);
  const [files, setFiles] = useState(1);

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-6" role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="composer-title" className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-t-3xl bg-white text-left shadow-2xl sm:rounded-3xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white/95 px-5 py-4 backdrop-blur sm:px-7">
          <div><p className="text-xs font-bold uppercase tracking-widest text-blue-700">Your experience</p><h2 id="composer-title" className="text-xl font-black">Write or edit your Review</h2></div>
          <button onClick={onClose} className="rounded-full p-2 hover:bg-slate-100" aria-label="Close composer"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-6 p-5 sm:p-7">
          <fieldset><legend className="text-sm font-bold">Review Bases <span className="font-normal text-slate-500">· choose at least one</span></legend><div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className={cx("flex cursor-pointer items-center gap-3 rounded-xl border p-3", courseBasis && "border-blue-400 bg-blue-50")}><input type="checkbox" checked={courseBasis} onChange={(event) => setCourseBasis(event.target.checked)} /><BookOpen className="h-5 w-5" /><span><strong className="block">Course</strong><small>COMP 2011</small></span></label>
            <label className={cx("flex cursor-pointer items-center gap-3 rounded-xl border p-3", instructorBasis && "border-blue-400 bg-blue-50")}><input type="checkbox" checked={instructorBasis} onChange={(event) => setInstructorBasis(event.target.checked)} /><UserRound className="h-5 w-5" /><span><strong className="block">Instructor</strong><small>Desmond Lee</small></span></label>
          </div>{!courseBasis && !instructorBasis && <p className="mt-2 text-sm font-medium text-rose-700">At least one Review Basis is required.</p>}</fieldset>

          <fieldset><legend className="text-sm font-bold">Optional Review Context</legend><div className="mt-2 grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-600">Term<select className="mt-1 w-full rounded-xl border-slate-300 text-sm"><option>No Term</option><option>2025-26 Fall</option><option>2024-25 Spring</option></select></label><label className="text-xs font-semibold text-slate-600">Section<select disabled={!courseBasis} className="mt-1 w-full rounded-xl border-slate-300 text-sm disabled:bg-slate-100"><option>No Section</option><option>L1 · Desmond Lee</option><option>L2 · Ada Chan</option></select></label></div></fieldset>

          <div><div className="mb-2 flex items-center justify-between"><label htmlFor="review-body" className="text-sm font-bold">Review <span className="font-normal text-slate-500">· Markdown</span></label><button onClick={() => setPreview(!preview)} className="text-xs font-bold text-blue-700">{preview ? "Continue editing" : "Preview"}</button></div>{preview ? <div className="min-h-36 rounded-xl border bg-slate-50 p-4 leading-7 text-slate-700">The examples build on each other well. <strong>Do the labs before tutorial.</strong></div> : <textarea id="review-body" className="min-h-36 w-full rounded-xl border-slate-300 text-sm" defaultValue="The examples build on each other well. **Do the labs before tutorial.**" />}</div>

          <div><div className="flex items-center justify-between"><div><p className="text-sm font-bold">Attachments · {files}/4</p><p className="text-xs text-slate-500">Files are preserved and not malware-scanned · 4.6 of 32 MiB used</p></div><button disabled={files >= 4} onClick={() => setFiles(Math.min(4, files + 1))} className="flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-40"><Plus className="h-4 w-4" /> Add file</button></div>{files > 0 && <div className="mt-3 flex items-center justify-between rounded-xl border bg-slate-50 p-3"><div className="flex items-center gap-3"><ImageIcon className="h-5 w-5 text-blue-700" /><div><p className="text-sm font-semibold">lab-diagram.png</p><p className="text-xs text-slate-500">Description: Lab inheritance diagram · inline + listed</p></div></div><button onClick={() => setFiles(Math.max(0, files - 1))} className="p-1 text-slate-400"><X className="h-4 w-4" /></button></div>}</div>

          <fieldset><legend className="text-sm font-bold">Public attribution</legend><div className="mt-2 grid gap-2 sm:grid-cols-2"><label className={cx("cursor-pointer rounded-xl border p-3", !identityHidden && "border-blue-400 bg-blue-50")}><input type="radio" name="identity" checked={!identityHidden} onChange={() => setIdentityHidden(false)} className="mr-2" /><strong>Show mapleleaf</strong><p className="mt-1 text-xs text-slate-500">Captured on this Review Revision.</p></label><label className={cx("cursor-pointer rounded-xl border p-3", identityHidden && "border-blue-400 bg-blue-50")}><input type="radio" name="identity" checked={identityHidden} onChange={() => setIdentityHidden(true)} className="mr-2" /><strong>Identity hidden</strong><p className="mt-1 text-xs text-slate-500">Hidden publicly, still linked internally.</p></label></div></fieldset>

          <div className="rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">Publishing makes Review text public under CC BY 4.0. Files use separate hosting permission. Identity hidden is not anonymous to UST Rankings.</div>
        </div>
        <div className="sticky bottom-0 flex items-center justify-between border-t bg-white/95 px-5 py-4 backdrop-blur sm:px-7"><button onClick={onClose} className="text-sm font-semibold text-slate-600">Cancel</button><button disabled={!courseBasis && !instructorBasis} onClick={onPublish} className="flex items-center gap-2 rounded-xl bg-[#003366] px-5 py-3 text-sm font-bold text-white disabled:opacity-40"><Send className="h-4 w-4" /> Publish Revision</button></div>
      </div>
    </div>
  );
}

function PrototypeSwitcher({ variant, setVariant, entity, signedIn }: { variant: Variant; setVariant: (variant: Variant) => void; entity: Entity; signedIn: boolean }) {
  const index = variants.findIndex((item) => item.key === variant);
  const cycle = (delta: number) => setVariant(variants[(index + delta + variants.length) % variants.length].key);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable) return;
      if (event.key === "ArrowLeft") cycle(-1);
      if (event.key === "ArrowRight") cycle(1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });
  return (
    <div className="fixed bottom-4 left-1/2 z-[80] flex -translate-x-1/2 items-center gap-2 rounded-full bg-slate-950 p-1.5 text-white shadow-2xl ring-1 ring-white/20">
      <button onClick={() => cycle(-1)} className="rounded-full p-2 hover:bg-white/10" aria-label="Previous variant"><ArrowLeft className="h-4 w-4" /></button>
      <div className="min-w-44 px-2 text-center"><p className="text-xs font-bold">{variant} · {variants[index].name}</p><p className="text-[10px] text-slate-400">{entity} · {signedIn ? "signed in" : "public reader"}</p></div>
      <button onClick={() => cycle(1)} className="rounded-full p-2 hover:bg-white/10" aria-label="Next variant"><ArrowRight className="h-4 w-4" /></button>
    </div>
  );
}

export function DetailPagePrototype() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const param = searchParams.get("variant")?.toUpperCase();
  const variant: Variant = param === "B" || param === "C" ? param : "A";
  const [entity, setEntity] = useState<Entity>("course");
  const [signedIn, setSignedIn] = useState(true);
  const [vote, setVote] = useState<Vote>("up");
  const [reactions, setReactions] = useState<string[]>(["love", "fire"]);
  const [composerOpen, setComposerOpen] = useState(false);
  const [reported, setReported] = useState<number | null>(null);
  const [published, setPublished] = useState(false);

  useEffect(() => {
    const hostHeader = document.body.querySelector(":scope > header");
    const previousOverflow = document.body.style.overflow;
    hostHeader?.setAttribute("aria-hidden", "true");
    hostHeader?.setAttribute("inert", "");
    document.body.style.overflow = "hidden";
    return () => {
      hostHeader?.removeAttribute("aria-hidden");
      hostHeader?.removeAttribute("inert");
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const setVariant = (next: Variant) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("variant", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };
  const toggleReaction = (reaction: string) => setReactions((current) => current.includes(reaction) ? current.filter((item) => item !== reaction) : [...current, reaction]);
  const common = useMemo<CommonProps>(() => ({
    entity,
    setEntity,
    signedIn,
    setSignedIn,
    openComposer: () => setComposerOpen(true),
    reported,
    setReported: (id) => setReported((current) => current === id ? null : id),
    signalProps: { signedIn, vote, setVote, reactions, toggleReaction },
  }), [entity, signedIn, reported, vote, reactions]);

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-white font-sans text-slate-900">
      {variant === "A" && <VariantA common={common} />}
      {variant === "B" && <VariantB common={common} />}
      {variant === "C" && <VariantC common={common} />}
      {composerOpen && <Composer onClose={() => setComposerOpen(false)} onPublish={() => { setComposerOpen(false); setPublished(true); }} />}
      {published && <div className="fixed right-4 top-20 z-[90] flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white shadow-xl"><Check className="h-4 w-4" /> Review Revision published <button onClick={() => setPublished(false)} aria-label="Dismiss"><X className="h-4 w-4" /></button></div>}
      {process.env.NODE_ENV !== "production" && <PrototypeSwitcher variant={variant} setVariant={setVariant} entity={entity} signedIn={signedIn} />}
    </div>
  );
}
