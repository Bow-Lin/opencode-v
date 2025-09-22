// Define the input type for a symbol candidate with its initial vector score
interface SymbolCandidate {
  symbol_fqn: string;
  vector_score: number; // The initial similarity score from vector search
  // We will fetch the full details from SQLite, but define the expected structure here
  details?: {
    name: string;
    module_fqn: string;
    type: string;
    visibility: string;
    docstring?: string;
    docstring_summary?: string;
    signature_parameters?: string; // JSON string from DB
    signature_returnType?: string;
    signature_decorators?: string; // JSON string from DB
  };
}

// Define the output type for a reranked symbol
interface RerankedSymbol {
  symbol_fqn: string;
  final_score: number;
  vector_score: number;
  name_score: number;
  doc_score: number;
  type_score: number;
  // Add other individual scores as needed for debugging or fine-tuning
}

/**
 * Reranks a list of symbol candidates based on their detailed information.
 * This function should be called after retrieving full symbol details from SQLite.
 * 
 * @param candidates - Array of symbol candidates with their initial vector scores and fetched details.
 * @param query - The user's original query string.
 * @returns Array of reranked symbols sorted by final score in descending order.
 */
export async function rerankSymbols(candidates: SymbolCandidate[], query: string): Promise<RerankedSymbol[]> {
  // 1. Preprocess the query for matching
  const queryTerms = query.toLowerCase().split(/\s+/).filter(term => term.length > 0);
  const queryTermSet = new Set(queryTerms);

  // 2. Calculate scores for each candidate
  const scoredCandidates: RerankedSymbol[] = candidates.map(candidate => {
    const details = candidate.details;
    if (!details) {
      // If details are not available, we can't rerank, so rely solely on vector score
      // This should ideally not happen if the function is called correctly after fetching details
      return {
        symbol_fqn: candidate.symbol_fqn,
        final_score: candidate.vector_score,
        vector_score: candidate.vector_score,
        name_score: 0,
        doc_score: 0,
        type_score: 0,
      };
    }

    // --- Calculate Individual Scores ---

    // a. Name Score (exact and partial match)
    let nameScore = 0;
    const symbolName = details.name.toLowerCase();
    if (queryTermSet.has(symbolName)) {
      nameScore = 1.0; // Exact match
    } else {
      // Partial match score
      for (const term of queryTerms) {
        if (symbolName.includes(term)) {
          nameScore = Math.max(nameScore, term.length / symbolName.length);
        }
      }
    }

    // b. Docstring Score (simple keyword frequency)
    let docScore = 0;
    const docstring = (details.docstring || details.docstring_summary || "").toLowerCase();
    if (docstring) {
      let matchCount = 0;
      for (const term of queryTerms) {
        // Count occurrences of the term in the docstring
        const regex = new RegExp(`\\b${term}\\b`, 'g');
        const matches = docstring.match(regex);
        matchCount += matches ? matches.length : 0;
      }
      // Normalize by docstring length to prevent bias towards longer docs
      // Add 1 to denominator to avoid division by zero
      docScore = matchCount / (docstring.split(/\s+/).length + 1);
      // Cap the score to be between 0 and 1
      docScore = Math.min(docScore, 1.0);
    }

    // c. Type Score (match query keywords to common type names)
    let typeScore = 0;
    const type = details.type.toLowerCase();
    // Simple heuristic: if query contains 'class', 'function', 'method' and matches type, boost score
    if ((query.includes("class") && type === "class") ||
        (query.includes("function") && type === "function") ||
        (query.includes("method") && type === "method")) {
      typeScore = 1.0;
    }

    // d. Signature Score (match parameters, return type - simplified)
    // This can be expanded later
    let signatureScore = 0;
    const signatureParams = details.signature_parameters ? JSON.parse(details.signature_parameters) as string[] : [];
    for (const param of signatureParams) {
      if (queryTermSet.has(param.toLowerCase())) {
        signatureScore += 1.0 / signatureParams.length; // Boost for each matching parameter
      }
    }

    // --- Combine Scores ---
    // These weights can be tuned experimentally
    const W_VECTOR = 0.4;
    const W_NAME = 0.3;
    const W_DOC = 0.2;
    const W_TYPE = 0.05;
    const W_SIGNATURE = 0.05;

    const finalScore = (
      W_VECTOR * candidate.vector_score +
      W_NAME * nameScore +
      W_DOC * docScore +
      W_TYPE * typeScore +
      W_SIGNATURE * signatureScore
    );

    return {
      symbol_fqn: candidate.symbol_fqn,
      final_score: finalScore,
      vector_score: candidate.vector_score,
      name_score: nameScore,
      doc_score: docScore,
      type_score: typeScore,
      // Add other scores if needed
    };
  });

  // 3. Sort by final score descending
  scoredCandidates.sort((a, b) => b.final_score - a.final_score);

  return scoredCandidates;
}