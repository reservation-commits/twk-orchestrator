-- Marcar quem recebe notificações de reserva por WhatsApp (opt-in — decisão do fundador, 2026-09-25).
-- Rodar pela porta única:  node orchestrator/agents/dba-escrita/executar.js <este arquivo> --apply --autonomo
-- Reversível (ADR-017): o executor faz backup das linhas tocadas e `desfazer.js --ultimo` restaura.
-- backup: public.aria_contact_consent where phone in ('+351912345678', '+33612345678')
--
-- Regras:
--   • phone SEMPRE em E.164 (com +DDI). Número ambíguo ou fixo não recebe, mesmo marcado.
--   • tipo = 'cliente' ou 'estabelecimento' (para casa, preencher restaurant_id).
--   • Para DESMARCAR: mesma linha com whatsapp_reservas = false.
--   • Nunca alterar outbound_opted_out aqui: isso é do cliente ("PARAR"/"VOLTAR").
BEGIN;
INSERT INTO public.aria_contact_consent (phone, whatsapp_reservas, tipo, restaurant_id, source, motivo, updated_at)
VALUES
  ('+351912345678', true, 'cliente',         NULL,              'fundador', 'canário 1ª leva', NOW()),
  ('+33612345678',  true, 'estabelecimento', 'REST_ID_AQUI',    'fundador', 'casa parceira que pediu aviso', NOW())
ON CONFLICT (phone) DO UPDATE
  SET whatsapp_reservas = EXCLUDED.whatsapp_reservas,
      tipo              = EXCLUDED.tipo,
      restaurant_id     = COALESCE(EXCLUDED.restaurant_id, aria_contact_consent.restaurant_id),
      source            = EXCLUDED.source,
      motivo            = EXCLUDED.motivo,
      updated_at        = NOW();
COMMIT;
