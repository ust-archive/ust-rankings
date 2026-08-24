/// <reference lib="webworker" />

import type {
  CourseQueryOperations,
  QueryRequest,
  QueryResponse,
} from "./protocol";
import {
  QueryError,
  queryCatalog,
  queryCourseDetails,
  queryCourseRankings,
} from "./runtime";

const scope = self as DedicatedWorkerGlobalScope;
let queue = Promise.resolve();

scope.addEventListener("message", (event: MessageEvent<QueryRequest>) => {
  queue = queue.then(async () => {
    const request = event.data;
    let response: QueryResponse;
    try {
      let output: unknown;
      if (request.operation === "catalog")
        output = await queryCatalog(
          request.input as CourseQueryOperations["catalog"]["input"],
          request.baseUrl,
        );
      else if (request.operation === "courseRankings")
        output = await queryCourseRankings(
          request.input as CourseQueryOperations["courseRankings"]["input"],
          request.baseUrl,
        );
      else
        output = await queryCourseDetails(
          request.input as CourseQueryOperations["courseDetails"]["input"],
          request.baseUrl,
        );
      response = { id: request.id, ok: true, output };
    } catch (error) {
      response = {
        id: request.id,
        ok: false,
        error:
          error instanceof QueryError
            ? { code: error.code, message: error.message }
            : {
                code: "unavailable",
                message: "Public Course data is unavailable.",
              },
      };
    }
    scope.postMessage(response);
  });
});
