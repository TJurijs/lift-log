import { ArrowLeft, ArrowRight, BookOpen, CircleUserRound, Copy, LoaderCircle, Pencil, Plus, Search, Settings2, Trash2, X } from "lucide-react";
import { useState } from "react";
import type { Exercise, ExerciseDiscipline, LoggingFormat, TrackingField } from "../../../lib/domain";
import { loggingFormatLabel } from "../../../lib/domain";
import { cn } from "../../../lib/presentation";
import { PageHeader, SegmentedTabs } from "../../ui-primitives";
import { ExerciseCategoryIcon, ExerciseCategoryMark } from "../../exercise-category-icons";
import { ExerciseVideoLink } from "../../exercise-video-link";
import { emptyExerciseLibraryFilters, exerciseFilterCategories, exerciseFormatOptions, exerciseTrackingOptions, exerciseTrainingStyles, exerciseTrainingStyleLabel, inferredExerciseDiscipline, modeLabel, toggleExerciseFilterValue, trackingFieldLabel, type ExerciseLibraryFilters } from "./exercise-library";

export default function ExercisesHome({
  scope,
  query,
  filters,
  global,
  personal,
  copyingExerciseId,
  loading,
  loadError,
  hasMore,
  onScope,
  onQuery,
  onFilters,
  onAdd,
  onOpen,
  onCopy,
  onEdit,
  onDelete,
  onLoadMore,
  onRetry,
}: {
  scope: "global" | "personal";
  query: string;
  filters: ExerciseLibraryFilters;
  global: Exercise[];
  personal: Exercise[];
  copyingExerciseId: string | null;
  loading: boolean;
  loadError: string;
  hasMore: boolean;
  onScope: (scope: "global" | "personal") => void;
  onQuery: (query: string) => void;
  onFilters: (filters: ExerciseLibraryFilters) => void;
  onAdd: () => void;
  onOpen: (exercise: Exercise) => void;
  onCopy: (exercise: Exercise) => void;
  onEdit: (exercise: Exercise) => void;
  onDelete: (exercise: Exercise) => void;
  onLoadMore: () => void;
  onRetry: () => void;
}) {
  return (
    <>
      <PageHeader
        eyebrow="Exercise library"
        title="Exercises"
        description="Browse provided movements or build your own reusable exercise collection."
      >
        <button className="button primary" onClick={onAdd}>
          <Plus size={16} />
          New exercise
        </button>
      </PageHeader>
      <SegmentedTabs
        className="exercise-source-tabs"
        label="Exercise sources"
        panelId="exercise-library-results"
        value={scope}
        onChange={onScope}
        tabs={[
          {
            value: "global",
            label: "Library",
            icon: BookOpen,
          },
          {
            value: "personal",
            label: "My exercises",
            icon: CircleUserRound,
          },
        ]}
      />
      {loadError && (
        <div className="feature-load-status error" role="alert">
          <span>{loadError}</span>
          <button className="text-button" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
      <ExercisesView
        key={scope}
        scope={scope}
        query={query}
        filters={filters}
        global={global}
        personal={personal}
        copyingExerciseId={copyingExerciseId}
        loading={loading}
        loadError={loadError}
        hasMore={hasMore}
        onQuery={onQuery}
        onFilters={onFilters}
        onOpen={onOpen}
        onCopy={onCopy}
        onEdit={onEdit}
        onDelete={onDelete}
        onLoadMore={onLoadMore}
      />
    </>
  );
}

export function ExercisesView({
  scope,
  query,
  filters,
  global,
  personal,
  copyingExerciseId,
  loading,
  loadError = "",
  hasMore,
  onQuery,
  onFilters,
  onOpen,
  onCopy,
  onEdit,
  onDelete,
  onLoadMore,
}: {
  scope: "global" | "personal";
  query: string;
  filters: ExerciseLibraryFilters;
  global: Exercise[];
  personal: Exercise[];
  copyingExerciseId: string | null;
  loading: boolean;
  loadError?: string;
  hasMore: boolean;
  onQuery: (query: string) => void;
  onFilters: (filters: ExerciseLibraryFilters) => void;
  onOpen: (exercise: Exercise) => void;
  onCopy: (exercise: Exercise) => void;
  onEdit: (exercise: Exercise) => void;
  onDelete: (exercise: Exercise) => void;
  onLoadMore: () => void;
}) {
  const source = scope === "global" ? global : personal;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(source.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleExercises = source.slice(
    currentPage * pageSize,
    currentPage * pageSize + pageSize,
  );
  const activeFilterCount =
    filters.disciplines.length +
    filters.categories.length +
    filters.formats.length +
    filters.tracking.length;
  function resetFilters() {
    setPage(0);
    onFilters(emptyExerciseLibraryFilters());
  }
  function toggleDiscipline(value: ExerciseDiscipline) {
    setPage(0);
    onFilters({
      ...filters,
      disciplines: toggleExerciseFilterValue(filters.disciplines, value),
    });
  }
  function toggleCategory(value: string) {
    setPage(0);
    onFilters({
      ...filters,
      categories: toggleExerciseFilterValue(filters.categories, value),
    });
  }
  function toggleFormat(value: LoggingFormat) {
    setPage(0);
    onFilters({
      ...filters,
      formats: toggleExerciseFilterValue(filters.formats, value),
    });
  }
  function toggleTracking(value: TrackingField) {
    setPage(0);
    onFilters({
      ...filters,
      tracking: toggleExerciseFilterValue(filters.tracking, value),
    });
  }
  return (
    <>
      <div className="library-toolbar panel">
        <div className="library-filter-actions">
          <label className="search-field library-search">
            <Search size={17} />
            <input
              aria-label="Search exercises"
              value={query}
              onChange={(event) => {
                setPage(0);
                onQuery(event.target.value);
              }}
              placeholder="Search exercises"
            />
          </label>
          <button
            className={cn("button secondary small library-filter-trigger", filtersOpen && "active")}
            aria-expanded={filtersOpen}
            aria-controls="exercise-filter-panel"
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <Settings2 size={15} />
            Filters{activeFilterCount ? ` · ${activeFilterCount}` : ""}
          </button>
        </div>
        {activeFilterCount > 0 && (
          <div className="library-active-filters" aria-label="Active filters">
            {filters.disciplines.map((style) => (
              <button key={style} onClick={() => toggleDiscipline(style)}>{exerciseTrainingStyleLabel(style)} <X size={12} /></button>
            ))}
            {filters.categories.map((category) => (
              <button className="filter-tag-category" key={category} onClick={() => toggleCategory(category)}>Category: {category} <X size={12} /></button>
            ))}
            {filters.formats.map((format) => (
              <button className="filter-tag-logging" key={format} onClick={() => toggleFormat(format)}>Format: {loggingFormatLabel(format)} <X size={12} /></button>
            ))}
            {filters.tracking.map((field) => (
              <button className="filter-tag-tracking" key={field} onClick={() => toggleTracking(field)}>Tracking: {trackingFieldLabel(field)} <X size={12} /></button>
            ))}
            <button className="clear" onClick={resetFilters}>Clear</button>
          </div>
        )}
        {filtersOpen && (
          <div className="library-filter-panel" id="exercise-filter-panel">
            <div>
              <span>Training style</span>
              <div className="library-filter-chip-row">
                {exerciseTrainingStyles.map(({ value, label }) => (
                  <button className={filters.disciplines.includes(value) ? "active" : ""} aria-pressed={filters.disciplines.includes(value)} key={value} onClick={() => toggleDiscipline(value)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span>Category</span>
              <div className="library-filter-chip-row">
                {exerciseFilterCategories.map((category) => (
                  <button className={cn("filter-tag-category", filters.categories.includes(category) && "active")} aria-pressed={filters.categories.includes(category)} key={category} onClick={() => toggleCategory(category)}>
                    <ExerciseCategoryIcon category={category} size={12} />
                    {category}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span>Format</span>
              <div className="library-filter-chip-row">
                {exerciseFormatOptions.map((format) => (
                  <button className={cn("filter-tag-logging", filters.formats.includes(format) && "active")} aria-pressed={filters.formats.includes(format)} key={format} onClick={() => toggleFormat(format)}>{loggingFormatLabel(format)}</button>
                ))}
              </div>
            </div>
            <div>
              <span>Tracking</span>
              <div className="library-filter-chip-row">
                {exerciseTrackingOptions.map((field) => (
                  <button className={cn("filter-tag-tracking", filters.tracking.includes(field) && "active")} aria-pressed={filters.tracking.includes(field)} key={field} onClick={() => toggleTracking(field)}>{trackingFieldLabel(field)}</button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      <div
        id="exercise-library-results"
        role="tabpanel"
        aria-label={scope === "global" ? "Library" : "My exercises"}
        aria-busy={loading}
      >
      <div className="library-meta">
        <span role="status">{loading ? "Loading exercises…" : `${source.length}${hasMore ? "+" : ""} exercises`}</span>
        {source.length > pageSize && (
          <span>
            {currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, source.length)}
          </span>
        )}
      </div>
      <div className="exercise-list panel">
        {!loading && !loadError && source.length === 0 && (
          <div className="empty-state compact">
            <BookOpen size={24} />
            <h3>{query.trim() || activeFilterCount ? "No exercises match" : scope === "personal" ? "Your exercise collection starts here" : "No exercises available"}</h3>
            <p>{query.trim() || activeFilterCount ? "Try another search or clear the filters." : scope === "personal" ? "Create a new exercise or copy one from the library to customize it." : "Try loading the library again."}</p>
            {(query.trim() || activeFilterCount > 0) && (
              <button className="button secondary small" onClick={() => { resetFilters(); onQuery(""); }}>Clear search and filters</button>
            )}
          </div>
        )}
        {visibleExercises.map((exercise) => (
          <article className="exercise-list-row" key={exercise.id}>
            {(() => {
              const style = inferredExerciseDiscipline(exercise);
              return (
            <button
              className="exercise-list-main"
              onClick={() => onOpen(exercise)}
              aria-label={`Open ${exercise.name}`}
            >
              <span className="exercise-list-identity">
                <ExerciseCategoryMark category={exercise.category} />
                <strong>{exercise.name}</strong>
              </span>
              <span className="exercise-list-parameters">
                {!(style === "weightlifting" && exercise.category === "Weightlifting") && (
                  <span className="exercise-parameter-tag category">{exercise.category}</span>
                )}
                <span className="exercise-parameter-tag logging">{modeLabel(exercise.defaultMode, exercise.defaultFields)}</span>
                {exercise.defaultFields.length ? exercise.defaultFields.map((field) => (
                  <span className="exercise-parameter-tag tracking" key={field}>{trackingFieldLabel(field)}</span>
                )) : <span className="exercise-parameter-tag tracking">No tracking</span>}
              </span>
            </button>
              );
            })()}
            <div className="exercise-list-actions">
              <ExerciseVideoLink
                url={exercise.videoUrl}
                exerciseName={exercise.name}
                size={15}
              />
              {exercise.scope === "global" ? (
                <button
                  className="icon-button"
                  disabled={copyingExerciseId === exercise.id}
                  aria-label={`Copy ${exercise.name} to My exercises`}
                  title="Copy to My exercises"
                  onClick={() => onCopy(exercise)}
                >
                  {copyingExerciseId === exercise.id ? (
                    <LoaderCircle className="button-spinner" size={15} />
                  ) : (
                    <Copy size={15} />
                  )}
                </button>
              ) : (
                <>
                  <button
                    className="icon-button"
                    aria-label={`Edit ${exercise.name}`}
                    title="Edit exercise"
                    onClick={() => onEdit(exercise)}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    className="icon-button danger"
                    aria-label={`Delete ${exercise.name}`}
                    title="Delete exercise"
                    onClick={() => onDelete(exercise)}
                  >
                    <Trash2 size={15} />
                  </button>
                </>
              )}
            </div>
          </article>
        ))}
      </div>
      {pageCount > 1 && (
        <nav className="library-pagination" aria-label="Exercise pages">
          <button
            className="button secondary small"
            disabled={currentPage === 0}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
          >
            <ArrowLeft size={14} /> Previous
          </button>
          <span>Page {currentPage + 1} of {pageCount}</span>
          <button
            className="button secondary small"
            disabled={currentPage >= pageCount - 1}
            onClick={() =>
              setPage((current) => Math.min(pageCount - 1, current + 1))
            }
          >
            Next <ArrowRight size={14} />
          </button>
        </nav>
      )}
      {hasMore && (
        <button
          className="button secondary small library-load-more"
          disabled={loading}
          onClick={onLoadMore}
        >
          {loading && <LoaderCircle className="button-spinner" size={14} />}
          {loading ? "Loading…" : "Load more exercises"}
        </button>
      )}
      </div>
    </>
  );
}
