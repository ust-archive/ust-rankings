import { notFound } from "next/navigation";
import { Reviews } from "@/app/courses/course-reviews";
import { loadReview } from "@/app/reviews/review-data";
import { Separator } from "@/components/ui/separator";

export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type ReviewPageProps = {
  params: Promise<{ reviewId: string }>;
};

export default function ReviewPage(props: ReviewPageProps) {
  return renderReviewPage(props);
}

export async function renderReviewPage(
  { params }: ReviewPageProps,
  read: typeof loadReview = loadReview,
) {
  const { reviewId } = await params;
  if (!UUID.test(reviewId)) notFound();
  const result = await read(reviewId.toLowerCase());
  if (result.unavailable)
    return (
      <section
        className="w-full rounded-xl border border-amber-300 bg-amber-50 p-6 text-left text-amber-950"
        role="status"
      >
        <h1 className="text-2xl font-bold">Review unavailable</h1>
        <p className="mt-2">
          Community contributions cannot be read right now. Rankings and Details
          remain independently available.
        </p>
      </section>
    );
  if (!result.review) notFound();
  const review = result.review;
  const editor = review.viewerCanEdit
    ? {
        courses: review.course ? [review.course] : [],
        instructors: review.instructorUuid
          ? [{ instructorUuid: review.instructorUuid, name: "Instructor" }]
          : [],
        contexts: review.termCode
          ? [
              {
                course: review.course,
                instructorUuid: review.instructorUuid,
                termCode: review.termCode,
                section: review.section,
              },
            ]
          : [],
      }
    : undefined;
  return (
    <article className="w-full max-w-3xl text-left text-slate-900">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-700">
          Community contribution
        </p>
        <h1 className="mt-2 text-4xl font-black tracking-tight">Review</h1>
        <p className="mt-2 text-slate-600">
          Stable Review permalink showing only the current public Review
          Revision.
        </p>
      </header>
      <Separator className="my-5" />
      <Reviews editor={editor} reviews={[review]} />
    </article>
  );
}
