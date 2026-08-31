console.log("NARRATIVE_ENABLED=" + process.env.PRYSM_NARRATIVE_V2_ENABLED);
console.log("LLM_MODE=" + process.env.PRYSM_LLM_MODE);
console.log("WRITER_MODEL=" + process.env.PRYSM_NARRATIVE_V2_WRITER_MODEL);
console.log("JUDGE_MODEL=" + process.env.PRYSM_NARRATIVE_V2_JUDGE_MODEL);
console.log("API_KEY_PRESENT=" + Boolean(process.env.PRYSM_NARRATIVE_V2_API_KEY));
console.log("CHAT_URL_PRESENT=" + Boolean(process.env.PRYSM_NARRATIVE_V2_CHAT_COMPLETIONS_URL));
console.log("PRICE_TABLE_PRESENT=" + Boolean(process.env.PRYSM_NARRATIVE_V2_PRICE_TABLE_JSON));
