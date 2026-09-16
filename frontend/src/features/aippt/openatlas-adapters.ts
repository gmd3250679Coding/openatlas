import {
  createPresentationDeckSnapshot,
  fetchPresentationDecks,
  fetchPresentationDeckVersions,
  generatePresentationDeckPlan,
  getPresentationDeck,
  researchPresentationDeckKnowledge,
  restorePresentationDeckVersion,
  runPresentationSlideAction,
  savePresentationDeckSnapshot,
  streamPresentationDeckPlan,
} from '../../services/api';
import type {
  AipptAgentAdapter,
  AipptDeckDocument,
  AipptDeckGenerateResponse,
  AipptDeckSaveResponse,
  AipptDeckVersion,
  AipptResearchAdapter,
  AipptResearchResponse,
  AipptSlideActionResponse,
  AipptStorageAdapter,
} from './adapters';

export function createOpenAtlasAipptStorageAdapter(): AipptStorageAdapter {
  return {
    async listDecks() {
      return fetchPresentationDecks() as Promise<AipptDeckDocument[]>;
    },
    async getDeck(id) {
      return getPresentationDeck(id) as Promise<AipptDeckDocument>;
    },
    async createSnapshot(body) {
      return createPresentationDeckSnapshot(body) as Promise<AipptDeckSaveResponse>;
    },
    async saveSnapshot(id, body) {
      return savePresentationDeckSnapshot(id, body) as Promise<AipptDeckSaveResponse>;
    },
    async listVersions(id) {
      return fetchPresentationDeckVersions(id) as Promise<AipptDeckVersion[]>;
    },
    async restoreVersion(deckId, versionId) {
      return restorePresentationDeckVersion(deckId, versionId) as Promise<AipptDeckSaveResponse>;
    },
  };
}

export function createOpenAtlasAipptAgentAdapter(): AipptAgentAdapter {
  return {
    async generateDeck(body) {
      return generatePresentationDeckPlan(body) as Promise<AipptDeckGenerateResponse>;
    },
    streamDeckPlan(body, opts) {
      return streamPresentationDeckPlan(body, opts);
    },
    async runSlideAction(deckId, body) {
      return runPresentationSlideAction(deckId, body) as Promise<AipptSlideActionResponse>;
    },
  };
}

export function createOpenAtlasAipptResearchAdapter(): AipptResearchAdapter {
  return {
    async researchKnowledge(body) {
      return researchPresentationDeckKnowledge(body) as Promise<AipptResearchResponse>;
    },
  };
}

export const OPENATLAS_AIPPT_STORAGE_ADAPTER = createOpenAtlasAipptStorageAdapter();
export const OPENATLAS_AIPPT_AGENT_ADAPTER = createOpenAtlasAipptAgentAdapter();
export const OPENATLAS_AIPPT_RESEARCH_ADAPTER = createOpenAtlasAipptResearchAdapter();
