export const DATA_PAGE_SIZE = 500;
export const DATA_ID_BATCH_SIZE = 100;
const DEFAULT_MAX_PAGES = 100;

export interface DataPage<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/**
 * Reads every PostgREST page explicitly so a project's `max_rows` setting can
 * never turn a successful response into silently truncated application data.
 */
export async function collectAllPages<T>(
  context: string,
  loadPage: (from: number, to: number) => PromiseLike<DataPage<T>>,
  options: { pageSize?: number; maxPages?: number } = {},
) {
  const pageSize = options.pageSize ?? DATA_PAGE_SIZE;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new Error("Page size must be a positive integer");
  }
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) {
    throw new Error("Maximum pages must be a positive integer");
  }

  const rows: T[] = [];
  for (let page = 0; page < maxPages; page += 1) {
    const from = page * pageSize;
    const result = await loadPage(from, from + pageSize - 1);
    if (result.error) {
      throw new Error(`${context}: ${result.error.message}`);
    }

    const pageRows = result.data ?? [];
    if (pageRows.length > pageSize) {
      throw new Error(`${context}: the data source exceeded the requested page size`);
    }
    rows.push(...pageRows);
    if (pageRows.length < pageSize) return rows;
  }

  throw new Error(
    `${context}: exceeded ${maxPages} pages; use a narrower query or increase the explicit limit`,
  );
}

export async function collectAllBatches<T, Id>(
  context: string,
  ids: readonly Id[],
  loadBatchPage: (
    ids: readonly Id[],
    from: number,
    to: number,
  ) => PromiseLike<DataPage<T>>,
  options: { batchSize?: number; pageSize?: number; maxPages?: number } = {},
) {
  const batchSize = options.batchSize ?? DATA_ID_BATCH_SIZE;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new Error("Batch size must be a positive integer");
  }

  const rows: T[] = [];
  for (let offset = 0; offset < ids.length; offset += batchSize) {
    const batch = ids.slice(offset, offset + batchSize);
    rows.push(
      ...(await collectAllPages(
        context,
        (from, to) => loadBatchPage(batch, from, to),
        options,
      )),
    );
  }
  return rows;
}
