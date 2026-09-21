import {describe, expect, it, vi} from "vitest";
import {LiftLogRepository} from "../../lib/repository";
import type {ActiveSession, WorkspaceData} from "../../lib/domain";

const runRow = (id: string, date: string) => ({id, athlete_id:"owner",created_by_id:"owner",program_id:"program",program_version_id:"version",title:"Training",status:"not_started",created_at:"2026-09-21T10:00:00Z",next_workout_id:`slot-${id}`,next_workout_title:"Workout",next_workout_status:"scheduled",next_workout_date:date,sort_date:date});
const repositoryFor = (rpc: ReturnType<typeof vi.fn>) => new LiftLogRepository({rpc} as never,"owner","Owner");

describe("unified Training repository",()=>{
  it("preserves server chronological cursors and separates active/history caches",async()=>{
    const rpc=vi.fn().mockResolvedValue({data:[runRow("first","2026-09-21"),runRow("next","2026-09-23")],error:null});
    const repository=repositoryFor(rpc);
    const first=await repository.listProgramRuns(undefined,{statusScope:"active",limit:1});
    expect(first.nextCursor).toEqual({id:"first",createdAt:"2026-09-21T10:00:00Z",sortDate:"2026-09-21"});
    await repository.listProgramRuns(undefined,{statusScope:"active",limit:1,cursor:first.nextCursor});
    expect(rpc).toHaveBeenLastCalledWith("list_program_run_summaries",expect.objectContaining({status_scope:"active",after_sort_date:"2026-09-21",after_id:"first",page_limit:2}));
    await repository.listProgramRuns(undefined,{statusScope:"history",limit:1});
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc).toHaveBeenLastCalledWith("list_program_run_summaries",expect.objectContaining({status_scope:"history"}));
  });

  it("sets optional dates through the single-occurrence operation and refreshes feed caches",async()=>{
    const mutation={athleteId:"owner",runId:"run",programId:"program",programVersionId:"version",created:true};
    const rpc=vi.fn(async(name:string)=>({data:name==="ensure_own_training_run"?mutation:[],error:null}));
    const repository=repositoryFor(rpc);
    await repository.listProgramRuns(undefined,{statusScope:"active"});
    expect(await repository.ensureOwnTrainingRun("program",[{workoutId:"workout"}],"retry-key")).toEqual(mutation);
    expect(rpc).toHaveBeenLastCalledWith("ensure_own_training_run",{target_program_id:"program",target_workout_dates:[{workoutId:"workout",plannedDate:null}],target_idempotency_key:"retry-key"});
    await repository.listProgramRuns(undefined,{statusScope:"active"});
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it("returns the exact active session after atomic undated start",async()=>{
    const rpc=vi.fn().mockResolvedValue({data:"session",error:null});
    const repository=repositoryFor(rpc);
    const session={id:"session",scheduledWorkoutId:"schedule",programRunId:"run",programRunWorkoutId:"slot"} as ActiveSession;
    vi.spyOn(repository as unknown as {loadBootstrapData():Promise<WorkspaceData>},"loadBootstrapData").mockResolvedValue({activeSession:session} as WorkspaceData);
    expect(await repository.startTrainingWorkout({runWorkoutId:"slot",plannedDate:"2026-09-21"})).toBe(session);
    expect(rpc).toHaveBeenCalledWith("start_training_workout",{target_program_id:null,target_workout_id:null,target_run_workout_id:"slot",target_planned_date:"2026-09-21"});
  });

  it("keeps history origin even when its program run is not loaded",async()=>{
    const rpc=vi.fn().mockResolvedValue({data:[{id:"session",workout_title:"Assigned workout",started_at:"2026-09-21T10:00:00Z",completed_at:"2026-09-21T11:00:00Z",completed_for_date:"2026-09-21",source_type:"coach"}],error:null});
    const result=await repositoryFor(rpc).listCompletedSessionSummaries();
    expect(result.items[0]).toMatchObject({id:"session",sourceType:"coach",workoutTitle:"Assigned workout"});
  });
});
