// Create an inline Web Worker that groups raw log lines by reqId. Kept as a
// generated Blob so the worker source ships inline with the bundle instead of
// needing a separate asset.
export function createInlineWorker(): Worker {
  const workerCode = `
    // Log aggregation Web Worker
    self.onmessage = function(event) {
      const { type, data } = event.data;

      if (type === 'groupLogsByReqId') {
        try {
          const { logs } = data;

          // Group logs by reqId
          const groupedLogs = {};

          logs.forEach((log, index) => {
            log = JSON.parse(log);
            let reqId = log.reqId || 'no-req-id';

            if (!groupedLogs[reqId]) {
              groupedLogs[reqId] = [];
            }
            groupedLogs[reqId].push(log);
          });

          // Sort each group's logs by timestamp
          Object.keys(groupedLogs).forEach(reqId => {
            groupedLogs[reqId].sort((a, b) => a.time - b.time);
          });

          // Extract model information
          const extractModelInfo = (reqId) => {
            const logGroup = groupedLogs[reqId];
            for (const log of logGroup) {
              try {
                // Try to parse JSON from the message field
                if (log.type === 'request body' && log.data && log.data.model) {
                  return log.data.model;
                }
              } catch (e) {
                // Parsing failed - keep trying the next log entry
              }
            }
            return undefined;
          };

          // Build summary information
          const summary = {
            totalRequests: Object.keys(groupedLogs).length,
            totalLogs: logs.length,
            requests: Object.keys(groupedLogs).map(reqId => ({
              reqId,
              logCount: groupedLogs[reqId].length,
              firstLog: groupedLogs[reqId][0]?.time,
              lastLog: groupedLogs[reqId][groupedLogs[reqId].length - 1]?.time,
              model: extractModelInfo(reqId)
            }))
          };

          const response = {
            grouped: true,
            groups: groupedLogs,
            summary
          };

          // Post the result back to the main thread
          self.postMessage({
            type: 'groupLogsResult',
            data: response
          });
        } catch (error) {
          // Post the error back to the main thread
          self.postMessage({
            type: 'error',
            error: error instanceof Error ? error.message : 'Unknown error occurred'
          });
        }
      }
    };
  `

  const blob = new Blob([workerCode], { type: 'application/javascript' })
  const workerUrl = URL.createObjectURL(blob)
  return new Worker(workerUrl)
}
