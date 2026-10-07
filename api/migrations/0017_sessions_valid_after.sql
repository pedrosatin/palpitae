-- Corte de sessões para "Sair de todos os dispositivos".
--
-- `POST /auth/logout-all` grava aqui o instante atual em segundos Unix (mesma
-- unidade do `iat` do JWT). A verificação de sessão rejeita todo token do usuário
-- com `iat` menor ou igual a esse valor, inclusive o da sessão que pediu a saída.
-- NULL (padrão) significa que nenhum corte foi pedido.
ALTER TABLE users ADD COLUMN sessions_valid_after INTEGER;
