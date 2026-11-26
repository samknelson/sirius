import { createContext, useContext } from "react";

/** Optional query inputs only; both evaluation and purchase still authorize on the server. */
export const ECHP_INPUTS_SLOT = "bao.echp.inputs";
export const EchpInputsContext = createContext<Readonly<Record<string, string>>>({});
export const useEchpInputs = () => useContext(EchpInputsContext);
