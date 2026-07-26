/**
 * langDetection tests — deterministic function-word voting.
 */

import { describe, it, expect } from 'vitest';
import { detectLanguage } from '../../../src/core/ner/langDetection.js';

describe('detectLanguage', () => {
  it('detects English', () => {
    expect(detectLanguage(
      'The system is down and we are looking into the problem with the database and the cache.',
    )).toBe('en');
  });

  it('detects Italian', () => {
    expect(detectLanguage(
      'Il contratto è stato firmato e la clausola che riguarda il pagamento non è valida per il cliente.',
    )).toBe('it');
  });

  it('detects French', () => {
    expect(detectLanguage(
      'Le contrat est signé et la clause qui concerne le paiement est dans le document.',
    )).toBe('fr');
  });

  it('detects German', () => {
    expect(detectLanguage(
      'Der Vertrag ist unterschrieben und die Klausel ist nicht gültig für den Kunden.',
    )).toBe('de');
  });

  it('detects Spanish', () => {
    expect(detectLanguage(
      'El contrato es firmado y la cláusula que no es válida para el cliente está en el documento.',
    )).toBe('es');
  });

  it('detects Portuguese', () => {
    expect(detectLanguage(
      'O contrato é assinado e a cláusula que não é válida para o cliente está no documento.',
    )).toBe('pt');
  });

  it('returns mixed for very short texts', () => {
    expect(detectLanguage('Hi there')).toBe('mixed');
  });

  it('returns non-latin for CJK text', () => {
    expect(detectLanguage('これはテストです。日本語のテキストです。コンピュータのテストを行います。')).toBe('non-latin');
  });

  it('returns mixed or the dominant language for mixed-language texts', () => {
    const result = detectLanguage(
      'Il sistema è down e the database non works. The user ha problemi con il login e the cache non risponde.',
    );
    expect(['mixed', 'it']).toContain(result);
  });
});
