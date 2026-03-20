import { Injectable } from "@nestjs/common";
import { ResourceType } from "@prisma/client";

type CharacterLike = {
  id: string;
  name: string;
  aliases: string[];
};

type GlossaryLike = {
  id: string;
  term: string;
  canonical_form: string;
};

type TimelineLike = {
  id: string;
  time_mark: string;
  event: string;
};

type RelationshipLike = {
  id: string;
  fromCharacter: { name: string };
  toCharacter: { name: string };
  relation_type: string;
};

type SensitiveWordLike = {
  id: string;
  term: string;
  replacement: string | null;
};

type RegexRuleLike = {
  id: string;
  name: string;
  pattern: string;
  flags: string | null;
};

export type ExtractedReferenceCandidate = {
  resource_type: ResourceType;
  resource_id: string;
  confidence: number;
  occurrence_count: number;
  evidence_json: Record<string, unknown>;
};

@Injectable()
export class StoryReferenceExtractorService {
  private normalize(value: string) {
    return value.trim().toLowerCase();
  }

  private countOccurrences(text: string, token: string) {
    if (!token.trim()) {
      return 0;
    }
    const lowerText = this.normalize(text);
    const lowerToken = this.normalize(token);
    if (!lowerToken) {
      return 0;
    }
    return Math.floor((lowerText.length - lowerText.replaceAll(lowerToken, "").length) / lowerToken.length);
  }

  private safeRegexMatches(text: string, pattern: string, flags?: string | null) {
    try {
      const uniqueFlags = Array.from(new Set((flags ?? "g").split("").filter(Boolean)));
      if (!uniqueFlags.includes("g")) {
        uniqueFlags.push("g");
      }
      const regex = new RegExp(pattern, uniqueFlags.join(""));
      return Array.from(text.matchAll(regex)).map((match) => match[0]);
    } catch {
      return [];
    }
  }

  extractFromText(args: {
    text: string;
    characters: CharacterLike[];
    glossary: GlossaryLike[];
    timeline: TimelineLike[];
    relationships: RelationshipLike[];
    sensitiveWords: SensitiveWordLike[];
    regexRules: RegexRuleLike[];
  }): ExtractedReferenceCandidate[] {
    const candidates: ExtractedReferenceCandidate[] = [];

    for (const character of args.characters) {
      const matches = [character.name, ...(character.aliases ?? [])]
        .map((item) => item.trim())
        .filter(Boolean)
        .map((token) => ({ token, count: this.countOccurrences(args.text, token) }))
        .filter((item) => item.count > 0);
      if (matches.length === 0) {
        continue;
      }
      candidates.push({
        resource_type: ResourceType.character,
        resource_id: character.id,
        confidence: matches.some((item) => item.token === character.name) ? 0.92 : 0.72,
        occurrence_count: matches.reduce((acc, item) => acc + item.count, 0),
        evidence_json: {
          matched_terms: matches.map((item) => item.token),
        },
      });
    }

    for (const item of args.glossary) {
      const matchedTerms = [item.term, item.canonical_form]
        .map((token) => token.trim())
        .filter(Boolean)
        .map((token) => ({ token, count: this.countOccurrences(args.text, token) }))
        .filter((match) => match.count > 0);
      if (matchedTerms.length === 0) {
        continue;
      }
      candidates.push({
        resource_type: ResourceType.glossary,
        resource_id: item.id,
        confidence: 0.85,
        occurrence_count: matchedTerms.reduce((acc, match) => acc + match.count, 0),
        evidence_json: {
          matched_terms: matchedTerms.map((match) => match.token),
        },
      });
    }

    for (const item of args.timeline) {
      const matchedTerms = [item.time_mark, item.event]
        .map((token) => token.trim())
        .filter((token) => token.length >= 2)
        .map((token) => ({ token, count: this.countOccurrences(args.text, token) }))
        .filter((match) => match.count > 0);
      if (matchedTerms.length === 0) {
        continue;
      }
      candidates.push({
        resource_type: ResourceType.timeline_event,
        resource_id: item.id,
        confidence: 0.7,
        occurrence_count: Math.max(...matchedTerms.map((match) => match.count)),
        evidence_json: {
          matched_terms: matchedTerms.map((match) => match.token),
        },
      });
    }

    for (const item of args.relationships) {
      const fromCount = this.countOccurrences(args.text, item.fromCharacter.name);
      const toCount = this.countOccurrences(args.text, item.toCharacter.name);
      if (fromCount === 0 || toCount === 0) {
        continue;
      }
      candidates.push({
        resource_type: ResourceType.relationship,
        resource_id: item.id,
        confidence: 0.66,
        occurrence_count: Math.min(fromCount, toCount),
        evidence_json: {
          matched_pair: [item.fromCharacter.name, item.toCharacter.name],
          relation_type: item.relation_type,
        },
      });
    }

    for (const item of args.sensitiveWords) {
      const count = this.countOccurrences(args.text, item.term);
      if (count <= 0) {
        continue;
      }
      candidates.push({
        resource_type: ResourceType.sensitive_word,
        resource_id: item.id,
        confidence: 0.98,
        occurrence_count: count,
        evidence_json: {
          matched_term: item.term,
          replacement: item.replacement,
        },
      });
    }

    for (const item of args.regexRules) {
      const matches = this.safeRegexMatches(args.text, item.pattern, item.flags);
      if (matches.length === 0) {
        continue;
      }
      candidates.push({
        resource_type: ResourceType.regex_rule,
        resource_id: item.id,
        confidence: 0.94,
        occurrence_count: matches.length,
        evidence_json: {
          rule_name: item.name,
          matches: matches.slice(0, 8),
        },
      });
    }

    return candidates;
  }
}
