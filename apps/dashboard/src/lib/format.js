import { format, isToday, isYesterday, differenceInMinutes } from 'date-fns';

export function formatMeetingDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'MMM d');
}

export function formatMeetingTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return format(d, 'h:mma').toLowerCase();
}

export function formatDuration(secs, start, end) {
  if (secs) return `${Math.max(1, Math.round(secs / 60))}m`;
  if (start && end) {
    const mins = Math.max(1, differenceInMinutes(new Date(end), new Date(start)));
    return `${mins}m`;
  }
  return '';
}

export function mapReportDetail(r) {
  const participants = (r.participants && r.participants.length)
    ? r.participants
    : [r.candidateName].filter(Boolean);
  return {
    ...r,
    date: formatMeetingDate(r.date) || formatMeetingDate(r.startTime),
    startTime: formatMeetingTime(r.startTime),
    endTime: formatMeetingTime(r.endTime),
    participants,
    transcript: r.transcript || [],
    verifiedSkills: r.verifiedSkills || [],
    strengths: r.strengths || [],
    concerns: r.concerns || [],
    actionItems: (r.actionItems || [])
      .map((a, i) => ({
        id: a.id || i + 1,
        text: a.text,
        done: !!a.done
      }))
      .filter((a) => {
        const t = String(a.text || '').toLowerCase();
        if (!t.trim()) return false;
        if (/^ask the candidate/.test(t)) return false;
        if (/^ask (them|him|her)\b/.test(t)) return false;
        if (/probe|follow-up question|next question/.test(t) && !/\b(send|email|schedule|share|attach)\b/.test(t)) return false;
        return true;
      }),
    tags: [],
    notes: r.notes || ''
  };
}

export function mapMeeting(m) {
  const start = m.startTime;
  return {
    id: m.id || m.sessionId,
    sessionId: m.sessionId || m.id,
    kind: m.kind || 'past',
    title: m.title || m.jobRole || 'Interview',
    time: formatMeetingTime(start),
    date: formatMeetingDate(start),
    duration: formatDuration(m.durationSecs, m.startTime, m.endTime),
    platform: m.platform || 'Google Meet',
    category: m.jobRole || '',
    participants: (m.participants && m.participants.length)
      ? m.participants
      : [m.candidateName].filter(Boolean),
    summary: m.summary || '',
    tags: m.jobRole ? [m.jobRole] : [],
    score: m.score,
    verifiedSkills: m.verifiedSkills || [],
    actionItems: (m.actionItems || []).map((a, i) => ({
      id: a.id || i + 1,
      text: a.text,
      done: !!a.done
    })),
    topics: m.topics || [],
    transcript: m.transcript || [],
    url: m.meetingUrl || m.url || '',
    candidateName: m.candidateName || '',
    jobRole: m.jobRole || '',
    reportStatus: m.reportStatus || null,
    recommendation: m.recommendation || null
  };
}
