/**
 * Public mount point for every web service.
 *
 * It lives in its own leaf module because the document builder needs it, and
 * importing the dispatcher just to read a string would pull the whole plugin
 * graph into the builder's import chain.
 */
export const WEB_SERVICE_BASE_PATH = "/api/ws";
