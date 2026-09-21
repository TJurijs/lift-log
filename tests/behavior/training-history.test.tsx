import {act, renderHook} from "@testing-library/react";
import {describe, expect, it, vi} from "vitest";
import {useTrainingHistory} from "../../app/features/history/useTrainingHistory";
import type {ProgramRunCursor, ProgramRunSummary} from "../../lib/domain";
import type {LiftLogRepository} from "../../lib/repository";

type Page=Awaited<ReturnType<LiftLogRepository["listProgramRuns"]>>;
const initial:ProgramRunSummary[]=[];
const cursor:ProgramRunCursor={id:"older",createdAt:"2026-09-03T10:00:00Z"};
const training=(id:string):ProgramRunSummary=>({
  id,athleteId:"athlete",createdById:"athlete",programId:`program-${id}`,programVersionId:`version-${id}`,
  title:id,status:"completed",totalWorkouts:1,completedWorkouts:1,scheduledWorkouts:1,completionPercent:100,
  createdAt:"2026-09-03T10:00:00Z",
});
const page=(ids:string[],nextCursor?:ProgramRunCursor):Page=>({items:ids.map(training),nextCursor,hasMore:Boolean(nextCursor)});
function deferred(){
  let resolve!:(page:Page)=>void;
  const promise=new Promise<Page>(done=>{resolve=done;});
  return {resolve,promise};
}

describe("Training history paging",()=>{
  it("loads history lazily with its own scope and cursor, coalescing duplicate requests",async()=>{
    const list=vi.fn<LiftLogRepository["listProgramRuns"]>()
      .mockResolvedValueOnce(page(["first","second"],cursor)).mockResolvedValueOnce(page(["second","third"]));
    const repository={listProgramRuns:list};
    const {result,rerender}=renderHook(({items})=>useTrainingHistory(repository,items),{initialProps:{items:initial}});
    expect(list).not.toHaveBeenCalled();
    await act(async()=>{await Promise.all([result.current.load(),result.current.load()]);});
    expect(list).toHaveBeenCalledExactlyOnceWith(undefined,{statusScope:"history",limit:25});
    rerender({items:[]});
    await act(async()=>{await result.current.load();});
    expect(list).toHaveBeenCalledTimes(1);
    await act(async()=>{await result.current.load(true);});
    expect(list).toHaveBeenLastCalledWith(undefined,{statusScope:"history",limit:25,cursor});
    expect(result.current.sessions.map(row=>row.id)).toEqual(["first","second","third"]);
    await act(async()=>{await result.current.load(true);});
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("retains visible results and retries the exact failed older page",async()=>{
    const list=vi.fn<LiftLogRepository["listProgramRuns"]>()
      .mockResolvedValueOnce(page(["first"],cursor)).mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValueOnce(page(["older"]));
    const repository={listProgramRuns:list};
    const {result}=renderHook(()=>useTrainingHistory(repository,initial));
    await act(async()=>{await result.current.load();});
    await act(async()=>{await result.current.load(true);});
    expect(result.current.error).toBe("Offline");
    expect(result.current.sessions.map(row=>row.id)).toEqual(["first"]);
    expect(result.current.cursor).toEqual(cursor);
    await act(async()=>{await result.current.load(true);});
    expect(list).toHaveBeenLastCalledWith(undefined,{statusScope:"history",limit:25,cursor});
    expect(result.current.sessions.map(row=>row.id)).toEqual(["first","older"]);
    expect(result.current.error).toBe("");
  });

  it("ignores an invalidated older response and refreshes the first page once",async()=>{
    const stale=deferred();
    const list=vi.fn<LiftLogRepository["listProgramRuns"]>()
      .mockResolvedValueOnce(page(["old"],cursor)).mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(page(["new","old"]));
    const repository={listProgramRuns:list};
    const {result}=renderHook(()=>useTrainingHistory(repository,initial));
    await act(async()=>{await result.current.load();});
    let pending!:Promise<void>;
    act(()=>{pending=result.current.load(true);});
    act(()=>{result.current.invalidate();result.current.invalidate();});
    await act(async()=>{stale.resolve(page(["stale"],cursor));await pending;});
    expect(list).toHaveBeenCalledTimes(3);
    expect(list).toHaveBeenLastCalledWith(undefined,{statusScope:"history",limit:25});
    expect(result.current.sessions.map(row=>row.id)).toEqual(["new","old"]);
    expect(result.current.cursor).toBeUndefined();
    expect(result.current.loading).toBe(false);
  });

  it("discards the previous account's response and ignores its retained invalidation callback",async()=>{
    const stale=deferred();
    const first={listProgramRuns:vi.fn().mockReturnValue(stale.promise)};
    const next={listProgramRuns:vi.fn().mockResolvedValue(page(["next-account"],cursor))};
    const {result,rerender}=renderHook(({repository})=>useTrainingHistory(repository,initial),{initialProps:{repository:first}});
    let pending!:Promise<void>;
    const staleInvalidate=result.current.invalidate;
    act(()=>{pending=result.current.load();});
    rerender({repository:next});
    await act(async()=>{await result.current.load();});
    act(()=>{staleInvalidate();});
    await act(async()=>{stale.resolve(page(["previous-account"]));await pending;});
    expect(result.current.sessions.map(row=>row.id)).toEqual(["next-account"]);
    expect(result.current.cursor).toEqual(cursor);
    expect(next.listProgramRuns).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBe("");
  });

  it("retries a failed invalidation refresh without using an obsolete history cursor",async()=>{
    const list=vi.fn<LiftLogRepository["listProgramRuns"]>()
      .mockResolvedValueOnce(page(["old"],cursor)).mockRejectedValueOnce(new Error("Refresh failed"))
      .mockResolvedValueOnce(page(["new","old"]));
    const repository={listProgramRuns:list};
    const {result}=renderHook(()=>useTrainingHistory(repository,initial));
    await act(async()=>{await result.current.load();});
    act(()=>{result.current.invalidate();});
    await act(async()=>{await result.current.load();});
    expect(result.current.error).toBe("Refresh failed");
    expect(result.current.sessions.map(row=>row.id)).toEqual(["old"]);
    await act(async()=>{await result.current.load(true);});
    expect(list).toHaveBeenLastCalledWith(undefined,{statusScope:"history",limit:25});
    expect(result.current.sessions.map(row=>row.id)).toEqual(["new","old"]);
  });
});
