-- ============================================================================
-- KitGest — SEED da conta DEMO (apresentação/venda)
-- Cole no SQL Editor do projeto e clique RUN.
-- Mira a org do usuário demo@kitgest.app, LIMPA o que houver e popula um
-- cenário fictício realista e SAUDÁVEL (88% de ocupação, margem positiva):
-- 3 casas, 8 quartos, 7 inquilinos/contratos (1 inadimplente), recebimentos
-- do mês (5 pagos + 2 em aberto), despesas e manutenção.
-- Roda como service_role (o SQL Editor ignora RLS). Idempotente: limpa e repopula.
-- OBS: a demo em produção já foi populada via API; este arquivo é o backup
-- para recriar o cenário em outra conta/projeto.
-- ============================================================================
do $$
declare
  v_org  uuid;
  v_comp date := date_trunc('month', current_date)::date;
  c1 uuid; c2 uuid; c3 uuid;
  q1 uuid; q2 uuid; q3 uuid; q4 uuid; q5 uuid; q6 uuid; q7 uuid; q8 uuid;
  i1 uuid; i2 uuid; i3 uuid; i4 uuid; i5 uuid; i6 uuid; i7 uuid;
  ct1 uuid; ct2 uuid; ct3 uuid; ct4 uuid; ct5 uuid; ct6 uuid; ct7 uuid;
begin
  select om.org_id into v_org
    from auth.users u
    join public.org_membros om on om.user_id = u.id
   where u.email = 'demo@kitgest.app'
   limit 1;
  if v_org is null then
    raise exception 'Conta demo@kitgest.app não encontrada — crie o login demo antes de rodar o seed.';
  end if;

  delete from public.recebimentos     where org_id = v_org;
  delete from public.acerto_itens     where org_id = v_org;
  delete from public.acertos_saida    where org_id = v_org;
  delete from public.vistoria_itens   where org_id = v_org;
  delete from public.vistorias        where org_id = v_org;
  delete from public.manutencao       where org_id = v_org;
  delete from public.avisos_enviados  where org_id = v_org;
  delete from public.contrato_reajustes where org_id = v_org;
  delete from public.contratos        where org_id = v_org;
  delete from public.quarto_rateio    where org_id = v_org;
  delete from public.despesas_casa    where org_id = v_org;
  delete from public.contas_pagar     where org_id = v_org;
  delete from public.inquilinos       where org_id = v_org;
  delete from public.quartos          where org_id = v_org;
  delete from public.casas            where org_id = v_org;

  c1 := gen_random_uuid(); c2 := gen_random_uuid(); c3 := gen_random_uuid();
  insert into public.casas (id, org_id, nome, endereco, aluguel_mae, criterio_rateio, qtd_quartos_ref) values
    (c1, v_org, 'Casa Azul — Centro',  'Rua das Palmeiras, 210 - Centro',  1400, 'igual',    3),
    (c2, v_org, 'Casa Verde — Jardim', 'Av. Brasil, 1450 - Jardim',        1750, 'area_m2',  3),
    (c3, v_org, 'Sobrado — Vila Rica', 'Rua 7 de Setembro, 88 - Vila Rica', 850, 'moradores',2);

  q1:=gen_random_uuid(); q2:=gen_random_uuid(); q3:=gen_random_uuid(); q4:=gen_random_uuid();
  q5:=gen_random_uuid(); q6:=gen_random_uuid(); q7:=gen_random_uuid(); q8:=gen_random_uuid();
  insert into public.quartos (id, org_id, casa_id, identificacao, aluguel_base, valor_final, area_m2, capacidade, status) values
    (q1, v_org, c1, 'Quarto 101', 750, 750, 14, 1, 'ocupado'),
    (q2, v_org, c1, 'Quarto 102', 750, 750, 14, 1, 'ocupado'),
    (q3, v_org, c1, 'Quarto 103', 780, 780, 16, 2, 'ocupado'),
    (q4, v_org, c2, 'Quarto 201', 880, 880, 18, 1, 'ocupado'),
    (q5, v_org, c2, 'Quarto 202', 880, 880, 18, 1, 'ocupado'),
    (q6, v_org, c2, 'Quarto 203', 900, 900, 20, 2, 'vago'),
    (q7, v_org, c3, 'Quarto A',   720, 720, 12, 1, 'ocupado'),
    (q8, v_org, c3, 'Quarto B',   720, 720, 12, 1, 'ocupado');

  i1:=gen_random_uuid(); i2:=gen_random_uuid(); i3:=gen_random_uuid(); i4:=gen_random_uuid();
  i5:=gen_random_uuid(); i6:=gen_random_uuid(); i7:=gen_random_uuid();
  insert into public.inquilinos (id, org_id, nome, telefone) values
    (i1, v_org, 'João Pereira', '(34) 99101-2020'),
    (i2, v_org, 'Maria Souza',  '(34) 99202-3030'),
    (i3, v_org, 'Pedro Santos', '(34) 99303-4040'),
    (i4, v_org, 'Ana Lima',     '(34) 99404-5050'),
    (i5, v_org, 'Carla Dias',   '(34) 99505-6060'),
    (i6, v_org, 'Bruno Alves',  '(34) 99606-7070'),
    (i7, v_org, 'Sofia Rocha',  '(34) 99707-8080');

  ct1:=gen_random_uuid(); ct2:=gen_random_uuid(); ct3:=gen_random_uuid(); ct4:=gen_random_uuid();
  ct5:=gen_random_uuid(); ct6:=gen_random_uuid(); ct7:=gen_random_uuid();
  insert into public.contratos
    (id, org_id, quarto_id, inquilino_id, dia_vencimento, valor_aluguel, caucao_valor,
     multa_percentual, juros_dia_percentual, data_inicio, data_fim, status) values
    (ct1, v_org, q1, i1,  5, 750, 750, 2, 0.033, current_date-200, current_date+165, 'ativo'),
    (ct2, v_org, q2, i2, 10, 750, 750, 2, 0.033, current_date-120, current_date+245, 'ativo'),
    (ct3, v_org, q3, i6,  8, 780, 780, 2, 0.033, current_date-40,  current_date+325, 'ativo'),
    (ct4, v_org, q4, i3,  5, 880, 880, 2, 0.033, current_date-90,  current_date+275, 'ativo'),
    (ct5, v_org, q5, i4, 15, 880, 880, 2, 0.033, current_date-300, current_date+65,  'inadimplente'),
    (ct6, v_org, q7, i5, 10, 720, 720, 2, 0.033, current_date-60,  current_date+305, 'ativo'),
    (ct7, v_org, q8, i7, 20, 720, 720, 2, 0.033, current_date-150, current_date+215, 'ativo');

  insert into public.recebimentos
    (org_id, contrato_id, quarto_id, inquilino_id, competencia, valor, forma, status, pago_em, recibo_numero) values
    (v_org, ct1, q1, i1, v_comp, 750, 'pix',      'pago',     now(), 1),
    (v_org, ct2, q2, i2, v_comp, 750, 'dinheiro', 'pago',     now(), 2),
    (v_org, ct3, q3, i6, v_comp, 780, 'pix',      'pago',     now(), 3),
    (v_org, ct4, q4, i3, v_comp, 880, 'pix',      'pago',     now(), 4),
    (v_org, ct6, q7, i5, v_comp, 720, 'pix',      'pago',     now(), 5),
    (v_org, ct5, q5, i4, v_comp, 880, 'pix',      'pendente', null,  null),
    (v_org, ct7, q8, i7, v_comp, 720, 'pix',      'pendente', null,  null);

  update public.orgs set recibo_seq = 5, nome = 'Kitnets Demonstração' where id = v_org;

  insert into public.despesas_casa (org_id, casa_id, tipo, descricao, valor, competencia, recorrente) values
    (v_org, c1, 'energia', 'Luz áreas comuns', 200, v_comp, true),
    (v_org, c2, 'energia', 'Luz áreas comuns', 220, v_comp, true),
    (v_org, c3, 'energia', 'Luz áreas comuns', 160, v_comp, true);

  insert into public.manutencao (org_id, casa_id, quarto_id, titulo, descricao, prioridade, status, custo) values
    (v_org, c2, q6,   'Pintura antes de alugar o 203', 'Preparar o quarto vago', 'media', 'aberta',    0),
    (v_org, c1, null, 'Troca de lâmpada do corredor',  'Concluído',              'baixa', 'concluida', 35);

  raise notice 'Seed da demo concluído para a org % (7/8 ocupados, margem positiva)', v_org;
end $$;
