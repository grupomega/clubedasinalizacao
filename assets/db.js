/* Clube da Sinalizacao - camada de dados via Supabase (producao) */

const CS_SUPABASE_URL = "https://zzljbyzbkmnqaxycotci.supabase.co";
const CS_SUPABASE_KEY = "sb_publishable_NpIk8S5Vfl0tgeUh6LYfAg_NL4jm5G0";
const csClient = window.supabase.createClient(CS_SUPABASE_URL, CS_SUPABASE_KEY);

const CS_UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

const CS_SEGMENTOS = [
  {value:'horizontal', label:'Horizontal'},
  {value:'vertical', label:'Vertical'},
  {value:'defensa', label:'Defensa'},
  {value:'conservacao', label:'Conservacao'},
  {value:'cones_placas_obra', label:'Cones e placas de obra'}
];

/* ===================== AUTH ===================== */

async function csGetUser(){
  const { data } = await csClient.auth.getUser();
  return data ? data.user : null;
}

async function csIsLogged(){
  const user = await csGetUser();
  return !!user;
}

async function csGetMyProfile(){
  const user = await csGetUser();
  if(!user) return null;
  const { data, error } = await csClient.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if(error){ console.error(error); return null; }
  return data;
}

function csNormalizeTelefone(t){
  return (t || '').replace(/\D/g, '');
}

async function csUploadFotoPerfil(userId, file){
  const path = `${userId}/${Date.now()}-${file.name}`;
  const { error } = await csClient.storage.from('perfis-fotos').upload(path, file);
  if(error) return { ok:false, error: error.message };
  const { data } = csClient.storage.from('perfis-fotos').getPublicUrl(path);
  return { ok:true, url: data.publicUrl };
}

async function csSignUp({email, password, nome, tipoUsuario, estado, cidade, telefone, fotoFile}){
  const telefoneNorm = csNormalizeTelefone(telefone);
  const { data, error } = await csClient.auth.signUp({
    email, password,
    options: { data: { nome, tipo_usuario: tipoUsuario } }
  });
  if(error) return { ok:false, error: error.message };

  if(data.session && data.user){
    let fotoUrl = null;
    if(fotoFile){
      const up = await csUploadFotoPerfil(data.user.id, fotoFile);
      if(up.ok) fotoUrl = up.url;
    }
    const { error: errProfile } = await csClient.from('profiles').update({
      estado, cidade, telefone: telefoneNorm,
      ...(fotoUrl ? { foto_url: fotoUrl } : {}),
      aceite_termos_versao: 'v1', aceite_termos_em: new Date().toISOString()
    }).eq('id', data.user.id);
    if(errProfile) return { ok:false, error: 'Cadastro criado, mas houve erro ao salvar dados do perfil: ' + errProfile.message };
    return { ok:true, needsEmailConfirm:false };
  }
  return { ok:true, needsEmailConfirm:true };
}

async function csLogin({login, password}){
  let email = login;
  if(!login.includes('@')){
    const telefoneNorm = csNormalizeTelefone(login);
    const { data, error } = await csClient.rpc('email_por_telefone', { p_telefone: telefoneNorm });
    if(error) return { ok:false, error: error.message };
    if(!data) return { ok:false, error: 'Nao encontramos cadastro com esse telefone.' };
    email = data;
  }
  const { error } = await csClient.auth.signInWithPassword({ email, password });
  if(error) return { ok:false, error: error.message };
  return { ok:true };
}

async function csLogout(){
  await csClient.auth.signOut();
}

/* ===================== FUNCOES (catalogo compartilhado) ===================== */

async function csListFuncoes(){
  const { data, error } = await csClient.from('funcoes_catalogo').select('*').order('nome');
  if(error){ console.error(error); return []; }
  return data;
}

/* ===================== OBRAS ===================== */

async function csListObras({segmento, uf, status} = {}){
  const authed = await csIsLogged();
  let q = csClient.from(authed ? 'obras' : 'obras_publicas').select('*').order('criado_em', {ascending:false});
  if(segmento) q = q.eq('segmento', segmento);
  if(uf) q = q.eq('estado', uf);
  if(status) q = q.eq('status', status);
  const { data, error } = await q;
  if(error){ console.error(error); return []; }
  return data;
}

async function csObrasKpis(){
  const authed = await csIsLogged();
  const table = authed ? 'obras' : 'obras_publicas';
  const ativas = await csClient.from(table).select('*', {count:'exact', head:true}).eq('status','ativo');
  const finalizadas = await csClient.from(table).select('*', {count:'exact', head:true}).eq('status','finalizado');
  const { data: ufRows } = await csClient.from(table).select('estado').eq('status','ativo');
  const ufSet = new Set((ufRows||[]).map(r => r.estado));
  return {
    ativas: ativas.count || 0,
    finalizadas: finalizadas.count || 0,
    estados: ufSet.size
  };
}

async function csObrasPorSegmento(){
  const authed = await csIsLogged();
  const table = authed ? 'obras' : 'obras_publicas';
  const { data } = await csClient.from(table).select('segmento').eq('status','ativo');
  const counts = {};
  (data||[]).forEach(r => counts[r.segmento] = (counts[r.segmento]||0)+1);
  return counts;
}

async function csCreateObra({cidade, estado, segmento, data_limite_retorno, servicos}){
  const user = await csGetUser();
  if(!user) return { ok:false, error:'nao autenticado' };
  const { data, error } = await csClient.from('obras').insert({
    contratante_id: user.id, cidade, estado, segmento, data_limite_retorno
  }).select().single();
  if(error) return { ok:false, error: error.message };

  const linhas = servicos.map(s => ({
    obra_id: data.id, tipo_servico: s.tipo_servico, unidade_medida: s.unidade_medida,
    quantidade_estimada: s.quantidade_estimada, valor_alvo_unitario: s.valor_alvo_unitario
  }));
  const { error: errServ } = await csClient.from('obra_servicos').insert(linhas);
  if(errServ) return { ok:false, error: errServ.message };

  return { ok:true, obra: data };
}

async function csEnviarInteresseObra(obraId){
  const user = await csGetUser();
  if(!user) return { ok:false, error:'nao autenticado' };
  const { error } = await csClient.from('obra_interesses').insert({ obra_id: obraId, respondente_id: user.id, mensagem: 'Interesse enviado pela plataforma' });
  if(error) return { ok:false, error: error.message };
  return { ok:true };
}

/* ===================== EQUIPAMENTOS (locacao / venda) ===================== */

const CS_CATEGORIAS_EQUIP = [
  {value:'caminhao_operacional', label:'Caminhao operacional'},
  {value:'caminhao_apoio', label:'Caminhao de apoio'},
  {value:'maquinas', label:'Maquinas'},
  {value:'ferramentas', label:'Ferramentas'},
  {value:'outros', label:'Outros'}
];

async function csListEquipamentos({tipoOferta, categoria, uf} = {}){
  const authed = await csIsLogged();
  let q = csClient.from(authed ? 'equipamentos' : 'equipamentos_publicos').select('*').order('criado_em', {ascending:false});
  if(tipoOferta) q = q.eq('tipo_oferta', tipoOferta);
  if(categoria) q = q.eq('categoria', categoria);
  if(uf) q = q.eq('estado', uf);
  const { data, error } = await q;
  if(error){ console.error(error); return []; }
  return data;
}

async function csUploadFotosEquipamento(fileList){
  const user = await csGetUser();
  if(!user) return { ok:false, error:'nao autenticado' };
  const urls = [];
  for(const file of fileList){
    const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2,8)}-${file.name}`;
    const { error } = await csClient.storage.from('equipamentos-fotos').upload(path, file);
    if(error) return { ok:false, error: error.message, urls };
    const { data } = csClient.storage.from('equipamentos-fotos').getPublicUrl(path);
    urls.push(data.publicUrl);
  }
  return { ok:true, urls };
}

async function csCreateEquipamento(fields){
  const user = await csGetUser();
  if(!user) return { ok:false, error:'nao autenticado' };
  const { error } = await csClient.from('equipamentos').insert({ ...fields, anunciante_id: user.id });
  if(error) return { ok:false, error: error.message };
  return { ok:true };
}

/* ===================== VAGAS ===================== */

async function csListVagas({uf} = {}){
  const authed = await csIsLogged();
  let q = csClient.from(authed ? 'vagas' : 'vagas_publicas').select('*, funcoes_catalogo(nome)').order('criado_em', {ascending:false});
  if(uf) q = q.eq('estado', uf);
  const { data, error } = await q;
  if(error){ console.error(error); return []; }
  return data;
}

async function csUploadImagemVaga(userId, file){
  const path = `${userId}/${Date.now()}-${file.name}`;
  const { error } = await csClient.storage.from('vagas-fotos').upload(path, file);
  if(error) return { ok:false, error: error.message };
  const { data } = csClient.storage.from('vagas-fotos').getPublicUrl(path);
  return { ok:true, url: data.publicUrl };
}

async function csCreateVaga(fields){
  const user = await csGetUser();
  if(!user) return { ok:false, error:'nao autenticado' };
  const { error } = await csClient.from('vagas').insert({ ...fields, empresa_id: user.id });
  if(error) return { ok:false, error: error.message };
  return { ok:true };
}

/* ===================== TALENTOS ===================== */

async function csListTalentos(){
  const authed = await csIsLogged();
  const table = authed ? 'professional_profiles' : 'talentos_publicos';
  const { data, error } = await csClient.from(table).select('*, funcoes_catalogo(nome)');
  if(error){ console.error(error); return []; }
  return data;
}

async function csUpsertTalento(fields){
  const user = await csGetUser();
  if(!user) return { ok:false, error:'nao autenticado' };
  const { error } = await csClient.from('professional_profiles').upsert({ ...fields, user_id: user.id }, { onConflict: 'user_id' });
  if(error) return { ok:false, error: error.message };
  return { ok:true };
}

/* ===================== AVALIACOES DE SERVICO (anonimo, 1-5, sem comentario) ===================== */

async function csListCriteriosAvaliacao(){
  const { data, error } = await csClient.from('criterios_avaliacao').select('*').order('ordem');
  if(error){ console.error(error); return []; }
  return data;
}

async function csListServicosAvaliacao({segmento, uf} = {}){
  const authed = await csIsLogged();
  let q = csClient.from(authed ? 'servicos_avaliacao' : 'servicos_avaliacao_publicos').select('*').order('criado_em', {ascending:false});
  if(segmento) q = q.eq('segmento', segmento);
  if(uf) q = q.eq('estado', uf);
  const { data, error } = await q;
  if(error){ console.error(error); return []; }
  return data;
}

async function csCreateServicoAvaliacao(fields){
  const user = await csGetUser();
  if(!user) return { ok:false, error:'nao autenticado' };
  const { data, error } = await csClient.from('servicos_avaliacao').insert({ ...fields, publicado_por: user.id }).select().single();
  if(error) return { ok:false, error: error.message };
  return { ok:true, servico: data };
}

async function csMeusVotos(servicoId){
  const user = await csGetUser();
  if(!user) return [];
  const { data, error } = await csClient.from('avaliacoes_votos').select('criterio_codigo').eq('servico_id', servicoId).eq('avaliador_id', user.id);
  if(error){ console.error(error); return []; }
  return data.map(r => r.criterio_codigo);
}

async function csEnviarVotos(servicoId, notas){
  // notas: { criterio_codigo: nota, ... }
  const user = await csGetUser();
  if(!user) return { ok:false, error:'nao autenticado' };
  const linhas = Object.entries(notas).map(([criterio_codigo, nota]) => ({
    servico_id: servicoId, avaliador_id: user.id, criterio_codigo, nota
  }));
  const { error } = await csClient.from('avaliacoes_votos').insert(linhas);
  if(error) return { ok:false, error: error.message };
  return { ok:true };
}

async function csResumoAvaliacao(servicoId){
  const { data, error } = await csClient.rpc('obter_resumo_avaliacao', { p_servico_id: servicoId });
  if(error){ console.error(error); return []; }
  return data;
}

/* ===================== CONTATO E DENUNCIAS (publico, sem login) ===================== */

async function csEnviarContato(fields){
  const { error } = await csClient.from('contato_mensagens').insert(fields);
  if(error) return { ok:false, error: error.message };
  return { ok:true };
}

async function csEnviarDenuncia(fields){
  const { error } = await csClient.from('denuncias').insert(fields);
  if(error) return { ok:false, error: error.message };
  return { ok:true };
}

/* ===================== PERFIL DE TALENTO (criterios + pontuacao) ===================== */

async function csListCriteriosPerfil(){
  const { data, error } = await csClient.from('criterios_perfil').select('*').order('ordem');
  if(error){ console.error(error); return []; }
  return data;
}

async function csGetMeuTalento(){
  const user = await csGetUser();
  if(!user) return null;
  const { data, error } = await csClient.from('professional_profiles').select('*').eq('user_id', user.id).maybeSingle();
  if(error){ console.error(error); return null; }
  return data;
}

async function csUploadCurriculo(userId, file){
  const path = `${userId}/${Date.now()}-${file.name}`;
  const { error } = await csClient.storage.from('curriculos-pdf').upload(path, file, { upsert: true });
  if(error) return { ok:false, error: error.message };
  const { data } = csClient.storage.from('curriculos-pdf').getPublicUrl(path);
  return { ok:true, url: data.publicUrl };
}

async function csSalvarPerfilTalento(fields){
  const user = await csGetUser();
  if(!user) return { ok:false, error:'nao autenticado' };
  const { error } = await csClient.from('professional_profiles').upsert({ ...fields, user_id: user.id }, { onConflict: 'user_id' });
  if(error) return { ok:false, error: error.message };
  return { ok:true };
}

async function csAtualizarMeuProfile(fields){
  const user = await csGetUser();
  if(!user) return { ok:false, error:'nao autenticado' };
  const { error } = await csClient.from('profiles').update(fields).eq('id', user.id);
  if(error) return { ok:false, error: error.message };
  return { ok:true };
}

/* ===================== NEGOCIACOES (propostas de locacao/venda) ===================== */

async function csContarInteressados(equipamentoId){
  const { data, error } = await csClient.rpc('contar_interessados_equipamento', { p_equipamento_id: equipamentoId });
  if(error){ console.error(error); return 0; }
  return data || 0;
}

async function csIniciarNegociacao(equipamentoId, anuncianteId, valorProposto, mensagem){
  const user = await csGetUser();
  if(!user) return { ok:false, error:'nao autenticado' };
  const { data: neg, error } = await csClient.from('negociacoes').insert({
    equipamento_id: equipamentoId, proponente_id: user.id, anunciante_id: anuncianteId
  }).select().single();
  if(error) return { ok:false, error: error.message };
  const { error: errMsg } = await csClient.from('negociacao_mensagens').insert({
    negociacao_id: neg.id, autor_id: user.id, tipo: 'proposta', valor_proposto: valorProposto || null, mensagem: mensagem || null
  });
  if(errMsg) return { ok:false, error: errMsg.message };
  return { ok:true, negociacao: neg };
}

async function csMinhasNegociacoes(){
  const user = await csGetUser();
  if(!user) return [];
  const { data, error } = await csClient.from('negociacoes')
    .select('*, equipamentos(equipamento, categoria, tipo_oferta)')
    .or(`proponente_id.eq.${user.id},anunciante_id.eq.${user.id}`)
    .order('atualizado_em', { ascending: false });
  if(error){ console.error(error); return []; }
  return data;
}

async function csMensagensNegociacao(negociacaoId){
  const { data, error } = await csClient.from('negociacao_mensagens')
    .select('*').eq('negociacao_id', negociacaoId).order('criado_em', { ascending: true });
  if(error){ console.error(error); return []; }
  return data;
}

async function csEnviarMensagemNegociacao(negociacaoId, tipo, valorProposto, mensagem){
  const user = await csGetUser();
  if(!user) return { ok:false, error:'nao autenticado' };
  const { error } = await csClient.from('negociacao_mensagens').insert({
    negociacao_id: negociacaoId, autor_id: user.id, tipo, valor_proposto: valorProposto || null, mensagem: mensagem || null
  });
  if(error) return { ok:false, error: error.message };
  return { ok:true };
}

/* ===================== UI comum a todas as paginas ===================== */

document.addEventListener('DOMContentLoaded', async function(){
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.querySelector('nav.main-nav');
  if(toggle && nav){ toggle.addEventListener('click', () => nav.classList.toggle('open')); }

  const current = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('nav.main-nav a.top-link').forEach(a => {
    const href = a.getAttribute('href').split('#')[0];
    if(href === current) a.classList.add('active');
  });

  document.querySelectorAll('.tabs').forEach(tabGroup => {
    const buttons = tabGroup.querySelectorAll('.tab-btn');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-tab');
        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('[data-tab-panel]').forEach(p => {
          if(p.closest('.tabs-wrap') === tabGroup.closest('.tabs-wrap')){
            p.classList.toggle('active', p.getAttribute('data-tab-panel') === target);
          }
        });
        history.replaceState(null,'','#'+target);
      });
    });
    const hash = window.location.hash.replace('#','');
    if(hash){
      const match = tabGroup.querySelector('[data-tab="'+hash+'"]');
      if(match) match.click();
    }
  });

  const userBox = document.getElementById('user-session-box');
  if(userBox){
    const user = await csGetUser();
    if(user){
      const profile = await csGetMyProfile();
      const nome = profile ? profile.nome : user.email;
      const pendente = profile && profile.status_validacao !== 'validado' ? ' <span class="badge badge-alerta">KYC pendente</span>' : '';
      const avatar = profile && profile.foto_url ? `<img src="${profile.foto_url}" style="width:22px;height:22px;border-radius:50%;object-fit:cover;vertical-align:-6px;margin-right:4px;">` : '<i class="ti ti-user"></i> ';
      userBox.innerHTML = '<span class="btn btn-outline btn-sm">' + avatar + nome + '</span>' + pendente + ' <a href="#" id="cs-logout" class="btn btn-sm btn-dark">Sair</a>';
      const out = document.getElementById('cs-logout');
      if(out) out.addEventListener('click', async (e) => { e.preventDefault(); await csLogout(); location.href = 'index.html'; });
    }
  }
});
