import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { privacyContactMailto } from "@/lib/privacy/contact";

export function Announcement() {
  return (
    <Alert className="border-slate-300 bg-white p-5 text-left sm:p-6">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Announcement
      </p>
      <AlertTitle
        aria-level={2}
        className="text-balance text-lg font-bold leading-tight text-slate-950"
        role="heading"
      >
        New UST Rankings!
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-3 text-sm leading-relaxed text-slate-600">
        <p>
          Hi there! Right before the enrollment period and the add/drop period,
          we have just released another new version of UST Rankings with some
          exciting features: the entire website is redesigned, and it now
          supports leaving a short review of an instructor / course / course
          offering / course section!
        </p>
        <p>
          We hope that you will enjoy the new features and improvements. As
          always, if you have any feedback or suggestions, please feel free to{" "}
          <a href={privacyContactMailto()}>contact us</a>.
        </p>
        <p className="text-right">UST Rankings Team. Aug 21, 2026.</p>
      </AlertDescription>
    </Alert>
  );
}
