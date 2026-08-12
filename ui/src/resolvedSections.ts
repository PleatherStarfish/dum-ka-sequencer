/**
 * Resolved timeline structure: pulse-span labels, section grouping from
 * resolved beats, and timing-grid summaries.
 * Extracted verbatim from App.tsx (carve-up round 9). Pure.
 */
import {
  AutomationBeatValue,
} from "./bridge";
import {
  PulseSpan,
  SubdivisionSwitchPreview,
  SubdivisionWeight,
} from "./bridge";
export function pulseSpanLabel(span: PulseSpan): string {
  if (span.kind === "gatiBeat") {
    if (span.tags.includes("custom-division")) {
      return `part ${span.beat ?? "?"} · subdivision ${span.gati ?? "?"} · ${span.matraLen} pulses`;
    }
    return `subdivision beat ${span.beat ?? "?"} · ${span.matraLen} pulses`;
  }
  if (span.kind === "jathiPulse") {
    return `grouping ${span.jathi ?? "?"} pulse ${span.index ?? "?"} · ${span.matraLen} pulses`;
  }
  return `section ${span.sectionIndex ?? "?"} · ${span.matraLen} pulses`;
}



export function groupResolvedSections(
  beats: ResolvedBeatView[],
  pulseSpans: PulseSpan[]
): ResolvedSectionRun[] {
  if (beats.length === 0) {
    return [];
  }

  const runs: ResolvedSectionRun[] = [];
  let sectionBeats: ResolvedBeatView[] = [beats[0]!];

  const pushSection = () => {
    const first = sectionBeats[0]!;
    const last = sectionBeats[sectionBeats.length - 1]!;
    const pulseSpansForSection = sectionPulseSpans(pulseSpans, first.sectionIndex);
    const sectionPulseSpan = pulseSpansForSection.find((span) => span.kind === "section");
    const gatiFrameSpan = pulseSpansForSection.find((span) => span.kind === "gatiBeat");
    const customDivisionSpans = pulseSpansForSection.filter(
      (span) => span.kind === "gatiBeat" && span.tags.includes("custom-division")
    );
    const sectionStartAkshara = sectionPulseSpan?.start ?? first.startAkshara;
    const sectionEndAkshara =
      sectionPulseSpan !== undefined
        ? sectionPulseSpan.start + sectionPulseSpan.duration
        : last.endAkshara;
    const startBeat = Math.floor(sectionStartAkshara) + 1;
    const endBeat = Math.max(startBeat, Math.ceil(sectionEndAkshara));
    const displayGati = customDivisionSpans.length
      ? customDivisionSpans[0]?.gati ?? first.gati
      : first.gati;
    const timingMatras =
      sectionPulseSpan?.matraLen ?? sectionBeats.length * first.effectiveGati;
    const customSubdivision = customDivisionSpans.length > 0;
    runs.push({
      sectionIndex: first.sectionIndex,
      startBeat,
      endBeat,
      gati: displayGati,
      effectiveGati: first.effectiveGati,
      timingMatras,
      // Equal-parts sections have no single per-part gati frame for regular
      // jathi validity. The engine deliberately treats the whole section as
      // one frame so a jathi may cross custom-part boundaries. Mirroring the
      // first custom GatiBeat span here incorrectly grayed out valid choices
      // such as j6 over four parts of gati 3 (12 total matras).
      gatiTimingFrameMatras: customSubdivision
        ? timingMatras
        : (gatiFrameSpan?.matraLen ?? first.effectiveGati),
      gatiTimingFrameBeats: customSubdivision
        ? sectionEndAkshara - sectionStartAkshara
        : (gatiFrameSpan?.duration ?? 1),
      jathi: first.jathi,
      customSubdivision,
      divisionCount: customDivisionSpans.length,
      beats: sectionBeats,
      pulseSpans: pulseSpansForSection,
    });
  };

  for (let i = 1; i < beats.length; i += 1) {
    const beat = beats[i]!;
    const startsNewSection =
      beat.sectionStart || beat.sectionIndex !== sectionBeats[0]!.sectionIndex;
    if (startsNewSection) {
      pushSection();
      sectionBeats = [beat];
    } else {
      sectionBeats.push(beat);
    }
  }
  pushSection();
  return runs;
}

export function buildResolvedBeats({
  preview,
  cycleBeats,
  initialWeights,
  pitch,
  velocity,
}: {
  preview: SubdivisionSwitchPreview | null;
  cycleBeats: number;
  initialWeights: SubdivisionWeight[];
  pitch: number;
  velocity: number;
}): ResolvedBeatView[] {
  const fallbackGati = initialWeights[0]?.subdivision ?? 4;
  const previewBeats = preview?.beats.length
    ? preview.beats
    : Array.from({ length: cycleBeats }, (_, i) => ({
        beat: i + 1,
        start: i / cycleBeats,
        end: (i + 1) / cycleBeats,
        gati: fallbackGati,
        effectiveGati: fallbackGati,
        divisionIndex: null,
        divisionCount: null,
        sectionIndex: 1,
        jathi: null,
        sectionStart: i === 0,
        accentVelocity: velocity,
        pitch,
        baseVelocity: velocity,
        automationPhase: null,
        automationValues: [],
      }));

  return previewBeats.map((previewBeat, i) => ({
    beat: previewBeat.beat ?? i + 1,
    gati: previewBeat.gati ?? fallbackGati,
    effectiveGati: previewBeat.effectiveGati ?? previewBeat.gati ?? fallbackGati,
    startAkshara: (previewBeat.start ?? i / cycleBeats) * cycleBeats,
    endAkshara: (previewBeat.end ?? (i + 1) / cycleBeats) * cycleBeats,
    divisionIndex: previewBeat.divisionIndex ?? null,
    divisionCount: previewBeat.divisionCount ?? null,
    sectionIndex: previewBeat.sectionIndex ?? 1,
    jathi: previewBeat.jathi ?? null,
    sectionStart: previewBeat.sectionStart ?? i === 0,
    accentVelocity: previewBeat.accentVelocity ?? velocity,
    pitch: previewBeat.pitch ?? pitch,
    baseVelocity: previewBeat.baseVelocity ?? velocity,
    automationPhase: previewBeat.automationPhase ?? null,
    automationValues: previewBeat.automationValues ?? [],
  }));
}

export function sectionTimingGridSummary(section: ResolvedSectionRun): {
  label: string;
  title?: string;
} {
  if (section.customSubdivision) {
    return {
      label: `${section.timingMatras} custom pulses`,
      title: `${section.divisionCount} equal parts across beats ${section.startBeat}-${section.endBeat}`,
    };
  }
  const nativeTotal = section.beats.length * section.gati;
  return {
    label: `${nativeTotal} pulses`,
  };
}

export interface ResolvedBeatView {
  beat: number;
  gati: number;
  effectiveGati: number;
  startAkshara: number;
  endAkshara: number;
  divisionIndex: number | null;
  divisionCount: number | null;
  sectionIndex: number;
  jathi: number | null;
  sectionStart: boolean;
  accentVelocity: number;
  pitch: number;
  baseVelocity: number;
  automationPhase: { numer: number; denom: number } | null;
  automationValues: AutomationBeatValue[];
}

export interface ResolvedSectionRun {
  sectionIndex: number;
  startBeat: number;
  endBeat: number;
  gati: number;
  effectiveGati: number;
  timingMatras: number;
  gatiTimingFrameMatras: number;
  gatiTimingFrameBeats: number;
  jathi: number | null;
  customSubdivision: boolean;
  divisionCount: number;
  beats: ResolvedBeatView[];
  pulseSpans: PulseSpan[];
}

export function sectionPulseSpans(
  pulseSpans: PulseSpan[],
  sectionIndex: number
): PulseSpan[] {
  return pulseSpans.filter((span) => span.sectionIndex === sectionIndex);
}
