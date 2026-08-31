(function initOrderTypeDetection(root) {
  const CAS_NUMBER_REGEX = /\b\d{2,7}-\d{2}-\d\b/g;
  const CAS_LABEL_REGEX = /^(?:cas\s*no\.?|casno|cas号|cas)$/i;
  const CAS_LINE_REGEX = /(?:cas\s*no\.?|casno|cas号|cas)\s*[：:：]?\s*([^\n\r]*)/gi;
  const PRODUCT_NUMBER_LINE_REGEX = /(?:货号|产品编号|订货号)\s*[：:]\s*([^\n\r]*)/gi;
  const CAS_EXTRACTION_RULES = {
    explicitCasField: {
      priority: 100,
      reason: "识别到明确 CAS 字段",
      getCandidates(context) {
        return [context.item?.cas_number || ""];
      },
    },
    casLabeledLine: {
      priority: 90,
      reason: "在页面 CAS 标签附近识别到合法 CAS",
      getCandidates(context) {
        return collectRegexGroupCandidates(context.pageText, CAS_LINE_REGEX);
      },
    },
    productNumberPrefix: {
      priority: 70,
      reason: "从货号前缀识别到合法 CAS",
      getCandidates(context) {
        return [
          context.item?.product_number || "",
          ...collectRegexGroupCandidates(context.pageText, PRODUCT_NUMBER_LINE_REGEX),
        ];
      },
      transform(candidate) {
        return String(candidate || "").split("#")[0].trim();
      },
    },
  };
  function normalizeText(input) {
    return String(input || "")
      .replaceAll("\u00a0", " ")
      .replaceAll(/\s+/g, " ")
      .trim();
  }

  function extractLeadingSpecificationValue(specificationText, options = {}) {
    const source = normalizeText(specificationText);
    if (!source) {
      return "";
    }

    const numericSource = options.ignoreLeadingLetters
      ? source.replace(/^[A-Za-z]+\s*/, "")
      : source;
    const start = /^\d+(?:\.\d+)?\s*/.exec(numericSource);
    if (!start) {
      return numericSource || source;
    }

    let result = start[0];
    let index = result.length;

    while (index < numericSource.length) {
      const char = numericSource[index];
      if (/[A-Za-zμµ]/.test(char)) {
        result += char;
        index += 1;
        continue;
      }

      if (/\s/.test(char)) {
        const next = numericSource[index + 1] || "";
        if (/[A-Za-zμµ]/.test(next)) {
          result += char;
          index += 1;
          continue;
        }
      }

      break;
    }

    return normalizeText(result) || numericSource || source;
  }

  function splitConsumableNameAndSpecification(name, fallbackSpecification = "") {
    const source = String(name || "").trim();
    const separatorIndex = source.search(/[,，]/);
    if (separatorIndex < 0) {
      return {
        name: source,
        specification: String(fallbackSpecification || "").trim(),
      };
    }

    return {
      name: source.slice(0, separatorIndex).trim(),
      specification: source.slice(separatorIndex + 1).trim(),
    };
  }

  function normalizePageText(input) {
    return String(input || "")
      .replaceAll("\u00a0", " ")
      .replaceAll(/\r/g, "\n")
      .replaceAll(/<br\s*\/?>/gi, "\n")
      .replaceAll(/<\/(?:p|div|tr|li|td|th|h\d)>/gi, "\n")
      .replaceAll(/<[^>]+>/g, " ")
      .split(/\n+/)
      .map((line) => normalizeText(line))
      .filter(Boolean)
      .join("\n");
  }

  function extractFirstCasNumber(input) {
    const matches = collectCasMatches(input);
    return matches[0] || "";
  }

  function collectCasMatches(input) {
    const source = String(input || "");
    const candidates = [];
    for (const match of source.matchAll(CAS_NUMBER_REGEX)) {
      const value = match[0];
      if (isValidCasNumber(value) && !candidates.includes(value)) {
        candidates.push(value);
      }
    }
    return candidates;
  }

  function calculateCasCheckDigit(sequenceNumber) {
    return sequenceNumber
      .split("")
      .reverse()
      .reduce((sum, digit, index) => sum + Number(digit) * (index + 1), 0) % 10;
  }

  function isValidCasNumber(input) {
    const candidate = String(input || "").trim();
    if (!/^\d{2,7}-\d{2}-\d$/.test(candidate)) {
      return false;
    }
    const [prefix, middle, checkDigit] = candidate.split("-");
    const expected = calculateCasCheckDigit(`${prefix}${middle}`);
    return expected === Number(checkDigit);
  }

  function collectRegexGroupCandidates(input, pattern) {
    const source = String(input || "");
    const regex = new RegExp(pattern.source, pattern.flags);
    const candidates = [];

    for (const match of source.matchAll(regex)) {
      const value = normalizeText(match[1] || "");
      if (value) {
        candidates.push(value);
      }
    }

    return candidates;
  }

  function normalizeCasExtractionContext(context) {
    const pageText = normalizePageText(context.pageText || context.html || "");
    return {
      html: String(context.html || ""),
      pageText,
      item: {
        cas_number: normalizeText(context.item?.cas_number || ""),
        product_number: normalizeText(context.item?.product_number || ""),
      },
    };
  }

  function extractCasFromRules(context) {
    const normalizedContext = normalizeCasExtractionContext(context);
    const orderedRules = Object.values(CAS_EXTRACTION_RULES).sort(
      (left, right) => right.priority - left.priority
    );

    for (const rule of orderedRules) {
      const rawCandidates = rule.getCandidates(normalizedContext);
      for (const rawCandidate of rawCandidates) {
        const candidate = normalizeText(rule.transform ? rule.transform(rawCandidate) : rawCandidate);
        const casNumber = extractFirstCasNumber(candidate);
        if (!casNumber) {
          continue;
        }

        return {
          cas_number: casNumber,
          reason: rule.reason,
        };
      }
    }

    return {
      cas_number: "",
      reason: "",
    };
  }

  function detectOrderClassification(item) {
    const casMatch = extractCasFromRules({
      item,
      html: item?.detail_html || "",
      pageText: item?.detail_text || "",
    });

    if (casMatch.cas_number) {
      return {
        cas_number: casMatch.cas_number,
        suggested_order_type: "reagent",
        order_type: "reagent",
        classification_reason: casMatch.reason,
      };
    }

    return {
      cas_number: "",
      suggested_order_type: "consumable",
      order_type: "consumable",
      classification_reason: "未识别到合法 CAS，默认归为耗材",
    };
  }

  function extractFieldByLabels(pageText, labels) {
    const lines = normalizePageText(pageText).split("\n");
    for (const line of lines) {
      const separatorIndex = line.search(/[：:]/);
      if (separatorIndex < 0) {
        continue;
      }
      const label = normalizeText(line.slice(0, separatorIndex));
      if (!labels.some((candidate) => candidate.toLowerCase() === label.toLowerCase())) {
        continue;
      }
      return normalizeText(line.slice(separatorIndex + 1));
    }
    return "";
  }

  const api = {
    CAS_EXTRACTION_RULES,
    extractCasFromRules,
    extractFieldByLabels,
    extractFirstCasNumber,
    extractLeadingSpecificationValue,
    isValidCasNumber,
    normalizePageText,
    detectOrderClassification,
    splitConsumableNameAndSpecification,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }

  root.OrderTypeDetection = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
