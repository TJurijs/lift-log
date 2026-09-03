import {
  Activity,
  ArrowLeft,
  ArrowRight,
  CalendarMinus,
  CalendarPlus,
  Check,
  ChevronRight,
  Dumbbell,
  TrendingUp,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  CompletedSession,
  ScheduledWorkout,
  ViewName,
} from "../../../lib/domain";
import { localDateOnly } from "../../../lib/date-only";
import { cn } from "../../../lib/presentation";

export interface CalendarViewProps {
  sessions: CompletedSession[];
  schedules: ScheduledWorkout[];
  weekStartsOnSunday: boolean;
  canSchedule: boolean;
  onNavigate: (view: ViewName) => void;
  onSchedule: () => void;
  onScheduleDay: (date: string) => void;
  onMoveSchedule: (scheduleId: string, date: string) => void;
  onRemoveSchedule: (scheduleId: string) => void;
  onOpenPlan: (schedule: ScheduledWorkout) => void;
  onOpenResults: (session: CompletedSession) => void;
  onVisibleRangeChange?: (rangeStart: string, rangeEnd: string) => void;
}

function dateOnly(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function PageHeader({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">Your schedule</p>
        <div className="page-title-row"><h1>Calendar</h1></div>
        <p>
          You decide when program workouts happen. Coaches can see this calendar
          but cannot change it.
        </p>
      </div>
      <div className="page-actions">{children}</div>
    </header>
  );
}

export default function CalendarView({
  sessions,
  schedules,
  weekStartsOnSunday,
  canSchedule,
  onNavigate,
  onSchedule,
  onScheduleDay,
  onMoveSchedule,
  onRemoveSchedule,
  onOpenPlan,
  onOpenResults,
  onVisibleRangeChange,
}: CalendarViewProps) {
  const [monthOffset, setMonthOffset] = useState(0);
  const [draggingScheduleId, setDraggingScheduleId] = useState<string | null>(
    null,
  );
  const [selectedDate, setSelectedDate] = useState(() => localDateOnly());
  const now = new Date();
  const baseDate = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  const days = new Date(year, month + 1, 0).getDate();
  const firstDay =
    (new Date(year, month, 1).getDay() - (weekStartsOnSunday ? 0 : 1) + 7) %
    7;
  const weekDays = weekStartsOnSunday
    ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const monthName = baseDate.toLocaleDateString("en", {
    month: "long",
    year: "numeric",
  });
  const monthStart = dateOnly(year, month, 1);
  const monthEnd = dateOnly(year, month, days);
  useEffect(() => {
    onVisibleRangeChange?.(monthStart, monthEnd);
  }, [monthEnd, monthStart, onVisibleRangeChange]);
  const sessionsByDate = useMemo(() => {
    const result = new Map<string, CompletedSession[]>();
    for (const session of sessions) {
      const group = result.get(session.date) ?? [];
      group.push(session);
      result.set(session.date, group);
    }
    return result;
  }, [sessions]);
  const schedulesByDate = useMemo(() => {
    const result = new Map<string, ScheduledWorkout[]>();
    for (const schedule of schedules) {
      if (!schedule.plannedDate || schedule.status !== "planned") continue;
      const group = result.get(schedule.plannedDate) ?? [];
      group.push(schedule);
      result.set(schedule.plannedDate, group);
    }
    return result;
  }, [schedules]);
  const monthSessions = sessions.filter(
    (session) => session.date >= monthStart && session.date <= monthEnd,
  );
  const monthSchedules = schedules.filter(
    (schedule) =>
      schedule.status === "planned" &&
      schedule.plannedDate !== undefined &&
      schedule.plannedDate >= monthStart &&
      schedule.plannedDate <= monthEnd,
  );
  const ratedSessions = monthSessions.filter((session) => session.rpe > 0);
  const averageRpe = ratedSessions.length
    ? ratedSessions.reduce((sum, session) => sum + session.rpe, 0) /
      ratedSessions.length
    : 0;
  const cells = Array.from({ length: firstDay + days }, (_, index) =>
    index < firstDay ? null : index - firstDay + 1,
  );
  const selectedSessions = sessionsByDate.get(selectedDate) ?? [];
  const selectedSchedules = schedulesByDate.get(selectedDate) ?? [];
  const selectedDateLabel = new Date(
    `${selectedDate}T12:00:00`,
  ).toLocaleDateString("en", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  function changeMonth(offset: number) {
    const nextOffset = monthOffset + offset;
    const nextMonth = new Date(
      now.getFullYear(),
      now.getMonth() + nextOffset,
      1,
    );
    setMonthOffset(nextOffset);
    setSelectedDate(localDateOnly(nextMonth));
  }

  return (
    <>
      <PageHeader>
        {canSchedule ? (
          <button className="button primary" onClick={onSchedule}>
            <CalendarPlus size={15} />
            Schedule workout
          </button>
        ) : (
          <button className="button primary" onClick={() => onNavigate("program")}>
            <Dumbbell size={15} />
            Choose a program
          </button>
        )}
      </PageHeader>
      <div className="calendar-stats">
        <div className="panel">
          <span><CalendarPlus size={18} /></span>
          <div><small>Planned this month</small><strong>{monthSchedules.length}</strong></div>
          <em>Dates chosen by you</em>
        </div>
        <div className="panel">
          <span><TrendingUp size={18} /></span>
          <div><small>Completed this month</small><strong>{monthSessions.length}</strong></div>
          <em>{monthSessions.length ? "Synced history" : "No sessions yet"}</em>
        </div>
        <div className="panel">
          <span><Activity size={18} /></span>
          <div><small>Average session RPE</small><strong>{averageRpe ? averageRpe.toFixed(1) : "—"}</strong></div>
          <em>{averageRpe ? "From completed logs" : "Add RPE after training"}</em>
        </div>
      </div>
      <div className="calendar-layout">
        <section className="calendar-card panel">
          <div className="calendar-heading">
            <button className="icon-button" aria-label="Previous month" onClick={() => changeMonth(-1)}>
              <ArrowLeft size={16} />
            </button>
            <h2>{monthName}</h2>
            <button className="icon-button" aria-label="Next month" onClick={() => changeMonth(1)}>
              <ArrowRight size={16} />
            </button>
          </div>
          <div className="calendar-grid">
            {weekDays.map((day) => <span className="calendar-dow" key={day}>{day}</span>)}
            {cells.map((day, index) => {
              if (!day) return <span className="calendar-day empty" key={`empty-${index}`} />;
              const date = dateOnly(year, month, day);
              const daySessions = sessionsByDate.get(date) ?? [];
              const daySchedules = schedulesByDate.get(date) ?? [];
              const isToday = date === localDateOnly(now);
              return (
                <div
                  className={cn(
                    "calendar-day",
                    daySessions.length > 0 && "trained",
                    daySchedules.length > 0 && "planned",
                    isToday && "today",
                    selectedDate === date && "selected",
                    draggingScheduleId && "schedule-target",
                  )}
                  key={date}
                  onDragOver={(event) => { if (draggingScheduleId) event.preventDefault(); }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const scheduleId = draggingScheduleId ?? event.dataTransfer.getData("text/plain");
                    setDraggingScheduleId(null);
                    if (scheduleId) {
                      setSelectedDate(date);
                      onMoveSchedule(scheduleId, date);
                    }
                  }}
                >
                  {canSchedule ? (
                    <button
                      type="button"
                      className="calendar-day-action calendar-day-schedule"
                      aria-label={`Schedule a workout on ${date}`}
                      onClick={() => { setSelectedDate(date); onScheduleDay(date); }}
                    ><span aria-hidden="true">{day}</span></button>
                  ) : <span className="calendar-day-number">{day}</span>}
                  <button
                    type="button"
                    className="calendar-day-action calendar-day-select"
                    aria-label={`Show calendar items for ${date}`}
                    aria-pressed={selectedDate === date}
                    onClick={() => setSelectedDate(date)}
                  ><span aria-hidden="true">{day}</span></button>
                  <div className="calendar-events">
                    {daySessions.map((session) => (
                      <button
                        key={session.id}
                        className="completed"
                        aria-label={`${session.workoutTitle}, completed on ${date}`}
                        onClick={(event) => { event.stopPropagation(); setSelectedDate(date); onOpenResults(session); }}
                      ><Check size={12} /><span>{session.workoutTitle}</span></button>
                    ))}
                    {daySchedules.map((schedule) => (
                      <div className="calendar-planned-event" key={schedule.id}>
                        <button
                          className="planned"
                          draggable
                          aria-label={`${schedule.workoutTitle}, scheduled on ${date}`}
                          onClick={(event) => { event.stopPropagation(); setSelectedDate(date); onOpenPlan(schedule); }}
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/plain", schedule.id);
                            setSelectedDate(date);
                            setDraggingScheduleId(schedule.id);
                          }}
                          onDragEnd={() => setDraggingScheduleId(null)}
                        ><CalendarPlus size={12} /><span>{schedule.workoutTitle}</span></button>
                        <button
                          className="calendar-event-remove"
                          aria-label={`Remove ${schedule.workoutTitle} from the calendar`}
                          title="Remove from calendar"
                          onClick={(event) => { event.stopPropagation(); setSelectedDate(date); onRemoveSchedule(schedule.id); }}
                        ><CalendarMinus size={11} /></button>
                      </div>
                    ))}
                  </div>
                  {isToday && !daySessions.length && !daySchedules.length ? <small>Today</small> : null}
                </div>
              );
            })}
          </div>
          <section className="calendar-day-agenda" aria-labelledby="calendar-selected-date-title">
            <div className="calendar-day-agenda-heading">
              <div><small>Selected day</small><h3 id="calendar-selected-date-title" aria-live="polite">{selectedDateLabel}</h3></div>
              {canSchedule && (
                <button type="button" className="button secondary small" onClick={() => onScheduleDay(selectedDate)}>
                  <CalendarPlus size={15} />Schedule workout
                </button>
              )}
            </div>
            {selectedSchedules.length || selectedSessions.length ? (
              <div className="calendar-day-agenda-list">
                {selectedSchedules.map((schedule) => (
                  <div className="calendar-day-agenda-row" key={schedule.id}>
                    <button type="button" className="calendar-day-agenda-main planned" onClick={() => onOpenPlan(schedule)}>
                      <CalendarPlus size={16} />
                      <span><strong>{schedule.workoutTitle}</strong><small>{schedule.programTitle} · Planned</small></span>
                      <ChevronRight size={16} />
                    </button>
                    <button type="button" className="icon-button" aria-label={`Remove ${schedule.workoutTitle} from the calendar`} title="Remove from calendar" onClick={() => onRemoveSchedule(schedule.id)}>
                      <CalendarMinus size={16} />
                    </button>
                  </div>
                ))}
                {selectedSessions.map((session) => (
                  <div className="calendar-day-agenda-row" key={session.id}>
                    <button type="button" className="calendar-day-agenda-main completed" onClick={() => onOpenResults(session)}>
                      <Check size={16} />
                      <span>
                        <strong>{session.workoutTitle}</strong>
                        <small>
                          Completed{session.durationMinutes ? ` · ${session.durationMinutes} min` : ""}{session.rpe ? ` · RPE ${session.rpe}` : ""}
                        </small>
                      </span>
                      <ChevronRight size={16} />
                    </button>
                  </div>
                ))}
              </div>
            ) : <p className="calendar-day-agenda-empty">No workouts on this day.</p>}
          </section>
          <div className="calendar-legend">
            <span><i className="planned-dot" />Scheduled by you</span>
            <span><i className="completed-dot" />Completed</span>
            <span><i className="today-dot" />Today</span>
          </div>
        </section>
      </div>
    </>
  );
}
