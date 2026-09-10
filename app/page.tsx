'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Clock3, Dog, Gauge, RefreshCw, Scale, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';

type PolicyId = 'petPriority' | 'preferredLift' | 'firstArrival';
type Request = { id: number; arrival: number; pet: boolean; willing: boolean };
type Result = { id: PolicyId; name: string; short: string; humanAverage: number; petAverage: number; overallAverage: number; p95: number; fairnessGap: number; served: number };

const POLICIES: Record<PolicyId, { name: string; short: string; detail: string }> = {
  petPriority: {
    name: 'Pet priority · any lift',
    short: 'Suggested rule',
    detail: 'A waiting pet party gets the next available lift and travels privately. Other residents wait.',
  },
  preferredLift: {
    name: 'Preferred pet lift',
    short: 'Dedicated approach',
    detail: 'One working lift carries pet parties. Other residents use the remaining lifts. With one lift, arrival order applies.',
  },
  firstArrival: {
    name: 'First arrival + choice',
    short: 'Courtesy approach',
    detail: 'The earliest party goes first. Residents who are comfortable may share; the later-arriving party otherwise waits.',
  },
};

function seeded(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function makeRequests(rate: number, petShare: number, shareComfort: number, seed: number) {
  const random = seeded(seed);
  const requests: Request[] = [];
  let arrival = 0;
  let id = 0;
  while (arrival < 180 && requests.length < 1000) {
    arrival += -Math.log(Math.max(random(), 0.00001)) / (rate / 60);
    if (arrival > 180) break;
    requests.push({ id: id++, arrival, pet: random() < petShare / 100, willing: random() < shareComfort / 100 });
  }
  return requests;
}

function percentile(values: number[], point: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * point))];
}

function simulate(id: PolicyId, requests: Request[], liftCount: number, cycleMinutes: number, seed: number): Result {
  const random = seeded(seed + id.length * 991);
  const queue: Request[] = [];
  const waits = new Map<number, number>();
  const busyUntil = Array(liftCount).fill(0) as number[];
  let requestIndex = 0;
  let time = requests[0]?.arrival ?? 0;

  const remove = (request: Request) => {
    const index = queue.findIndex((item) => item.id === request.id);
    if (index >= 0) queue.splice(index, 1);
  };

  while ((requestIndex < requests.length || queue.length) && waits.size < requests.length) {
    while (requestIndex < requests.length && requests[requestIndex].arrival <= time + 0.0001) queue.push(requests[requestIndex++]);

    const available = busyUntil.map((until, index) => ({ until, index })).filter((lift) => lift.until <= time + 0.0001);
    for (const lift of available) {
      if (!queue.length) break;
      let chosen: Request | undefined;

      if (id === 'petPriority') chosen = queue.find((item) => item.pet) ?? queue[0];
      else if (id === 'preferredLift' && liftCount > 1) chosen = lift.index === 0 ? queue.find((item) => item.pet) : queue.find((item) => !item.pet);
      else chosen = queue[0];

      if (!chosen) continue;
      const riders = [chosen];
      remove(chosen);

      if (!chosen.pet) {
        const candidates = queue.slice();
        for (const candidate of candidates) {
          if (riders.length >= 4 || candidate.pet) continue;
          riders.push(candidate);
          remove(candidate);
        }
      } else if (id === 'firstArrival') {
        const candidates = queue.slice();
        for (const candidate of candidates) {
          if (riders.length >= 4) break;
          if (!candidate.pet && candidate.willing) {
            riders.push(candidate);
            remove(candidate);
          }
        }
      }

      for (const rider of riders) waits.set(rider.id, Math.max(0, time - rider.arrival));
      busyUntil[lift.index] = time + cycleMinutes * (0.82 + random() * 0.36) + (riders.length - 1) * 0.08;
    }

    const nextArrival = requests[requestIndex]?.arrival ?? Infinity;
    const nextBusyLift = Math.min(...busyUntil.filter((until) => until > time + 0.0001), Infinity);
    const future = queue.length ? Math.min(nextArrival, nextBusyLift) : nextArrival;
    if (!Number.isFinite(future)) break;
    time = future;
  }

  const humanWaits = requests.filter((r) => !r.pet && waits.has(r.id)).map((r) => waits.get(r.id) ?? 0);
  const petWaits = requests.filter((r) => r.pet && waits.has(r.id)).map((r) => waits.get(r.id) ?? 0);
  const all = [...humanWaits, ...petWaits];
  const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const humanAverage = average(humanWaits);
  const petAverage = average(petWaits);

  return { id, name: POLICIES[id].name, short: POLICIES[id].short, humanAverage, petAverage, overallAverage: average(all), p95: percentile(all, 0.95), fairnessGap: Math.abs(humanAverage - petAverage), served: all.length };
}

function minutes(value: number) {
  return value < 0.05 ? '<0.1' : value.toFixed(1);
}

function Control({ label, value, suffix, min, max, step = 1, onChange }: { label: string; value: number; suffix: string; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  return (
    <label className="control">
      <span><b>{label}</b><output>{value}{suffix}</output></span>
      <Slider aria-label={label} min={min} max={max} step={step} value={[value]} onValueChange={(next) => onChange(Array.isArray(next) ? next[0] : next)} />
      <small>{min}{suffix}<i />{max}{suffix}</small>
    </label>
  );
}

export default function Home() {
  const [lifts, setLifts] = useState(3);
  const [arrivals, setArrivals] = useState(48);
  const [petShare, setPetShare] = useState(10);
  const [comfort, setComfort] = useState(50);
  const [cycle, setCycle] = useState(2.5);
  const [seed, setSeed] = useState(42);
  const [focus, setFocus] = useState<PolicyId>('petPriority');

  useEffect(() => {
    type Inputs = { lifts?: number; arrivalsPerHour?: number; petPercent?: number; comfortableSharingPercent?: number; cycleMinutes?: number };
    type ModelContext = { registerTool: (tool: Record<string, unknown>, options?: { signal?: AbortSignal }) => void | Promise<void> };
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const ranges: Record<keyof Inputs, [number, number]> = {
      lifts: [1, 5], arrivalsPerHour: [12, 120], petPercent: [2, 30], comfortableSharingPercent: [0, 100], cycleMinutes: [1, 5],
    };
    void Promise.resolve(context.registerTool({
      name: 'configure_lift_simulation',
      title: 'Configure lift simulation',
      description: 'Update the visible building assumptions and rerun the three lift-policy comparisons.',
      inputSchema: {
        type: 'object',
        properties: {
          lifts: { type: 'number', minimum: 1, maximum: 5 },
          arrivalsPerHour: { type: 'number', minimum: 12, maximum: 120 },
          petPercent: { type: 'number', minimum: 2, maximum: 30 },
          comfortableSharingPercent: { type: 'number', minimum: 0, maximum: 100 },
          cycleMinutes: { type: 'number', minimum: 1, maximum: 5 },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input: unknown) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Settings must be an object.');
        const values = input as Inputs;
        for (const [key, value] of Object.entries(values)) {
          if (!(key in ranges) || typeof value !== 'number') throw new Error(`Invalid setting: ${key}`);
          const [min, max] = ranges[key as keyof Inputs];
          if (value < min || value > max) throw new Error(`${key} must be between ${min} and ${max}.`);
        }
        if (values.lifts !== undefined) setLifts(Math.round(values.lifts));
        if (values.arrivalsPerHour !== undefined) setArrivals(Math.round(values.arrivalsPerHour));
        if (values.petPercent !== undefined) setPetShare(values.petPercent);
        if (values.comfortableSharingPercent !== undefined) setComfort(values.comfortableSharingPercent);
        if (values.cycleMinutes !== undefined) setCycle(values.cycleMinutes);
        setSeed((value) => value + 1);
        return { status: 'updated', settings: values };
      },
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, []);

  const results = useMemo(() => {
    const requests = makeRequests(arrivals, petShare, comfort, seed);
    return (Object.keys(POLICIES) as PolicyId[]).map((policy) => simulate(policy, requests, lifts, cycle, seed));
  }, [arrivals, comfort, cycle, lifts, petShare, seed]);

  const selected = results.find((result) => result.id === focus) ?? results[0];
  const best = [...results].sort((a, b) => (a.overallAverage + a.fairnessGap * 0.35) - (b.overallAverage + b.fairnessGap * 0.35))[0];
  const maxWait = Math.max(1, ...results.flatMap((result) => [result.humanAverage, result.petAverage]));

  return (
    <main>
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true"><ArrowRight /></div>
        <div><p className="eyebrow">Community lift policy lab</p><h1>Who waits—and for how long?</h1></div>
        <Button variant="outline" onClick={() => setSeed((value) => value + 1)}><RefreshCw /> New sample</Button>
      </header>

      <section className="workspace">
        <aside className="panel controls-panel">
          <div className="section-heading"><span>01</span><div><h2>Set the building</h2><p>Model a three-hour busy period.</p></div></div>
          <Control label="Working lifts" value={lifts} suffix="" min={1} max={5} onChange={setLifts} />
          <Control label="Arriving parties" value={arrivals} suffix="/hr" min={12} max={120} step={4} onChange={setArrivals} />
          <Control label="Pet parties" value={petShare} suffix="%" min={2} max={30} onChange={setPetShare} />
          <Control label="Comfortable sharing" value={comfort} suffix="%" min={0} max={100} step={5} onChange={setComfort} />
          <Control label="Average lift cycle" value={cycle} suffix=" min" min={1} max={5} step={0.5} onChange={setCycle} />
          <div className="assumption-note"><Clock3 /><p><b>What is a cycle?</b> Lobby boarding, travel, unloading and return availability. Each run varies ±18%.</p></div>
        </aside>

        <section className="results-area">
          <div className="summary-strip">
            <div><Gauge /><span><small>Lowest balanced score</small><b>{best.name}</b></span></div>
            <p>Based on total waiting plus 35% of the human–pet wait gap. Change any assumption to test it.</p>
          </div>

          <div className="panel chart-panel">
            <div className="chart-header">
              <div><p className="eyebrow">Average wait · minutes</p><h2>Same traffic, three rules</h2></div>
              <div className="legend"><span className="human-dot" />Residents <span className="pet-dot" />Pet parties</div>
            </div>
            <figure className="bars" aria-label="Average waiting time comparison for residents and pet parties">
              {results.map((result) => (
                <button key={result.id} aria-label={`View details for ${result.name}`} className={`bar-row ${focus === result.id ? 'active' : ''}`} onClick={() => setFocus(result.id)}>
                  <span className="policy-label"><small>{result.short}</small><b>{result.name}</b></span>
                  <span className="bar-stack">
                    <span className="bar-line"><i className="human-bar" style={{ width: `${Math.max(2, result.humanAverage / maxWait * 100)}%` }} /><em>{minutes(result.humanAverage)}</em></span>
                    <span className="bar-line"><i className="pet-bar" style={{ width: `${Math.max(2, result.petAverage / maxWait * 100)}%` }} /><em>{minutes(result.petAverage)}</em></span>
                  </span>
                </button>
              ))}
            </figure>
          </div>

          <div className="metrics-grid">
            <article className="panel policy-card">
              <div className="policy-title"><span>{selected.short}</span><h2>{selected.name}</h2></div>
              <p>{POLICIES[selected.id].detail}</p>
              <div className="metric-row">
                <div><Users /><small>Resident wait</small><b>{minutes(selected.humanAverage)} min</b></div>
                <div><Dog /><small>Pet-party wait</small><b>{minutes(selected.petAverage)} min</b></div>
                <div><Scale /><small>Fairness gap</small><b>{minutes(selected.fairnessGap)} min</b></div>
              </div>
            </article>
            <article className="panel read-card">
              <p className="eyebrow">How to read this</p><h2>A rule can be fast and still feel unfair.</h2>
              <p>Compare the overall delay with the gap between groups. A large gap means one group consistently absorbs the inconvenience.</p>
              <div className="p95"><span>95% wait less than</span><b>{minutes(selected.p95)} min</b></div>
            </article>
          </div>
        </section>
      </section>

      <section className="method">
        <div><span>02</span><h2>Transparent assumptions</h2></div>
        <p>This is an illustrative queue model, not a safety or legal finding. Arrivals are random but repeatable. Resident groups share up to four places. Pet parties ride privately under the first two rules; under the courtesy rule, willing residents may share. It does not model lift capacity by weight, floor-specific demand, emergencies or maintenance downtime within the three-hour run.</p>
      </section>
    </main>
  );
}
