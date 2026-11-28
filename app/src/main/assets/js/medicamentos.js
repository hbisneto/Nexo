"use strict";

/**
 * Medicamentos – interface.
 * Persistência: js/medicamentos-store.js (SQLite no Android, IndexedDB no navegador).
 * Todo texto vindo dos dados é inserido via textContent (nunca innerHTML).
 */
(function () {
    const S = window.NexoMedicamentos;

    const $ = function (id) { return document.getElementById(id); };

    const listaEl = $("listaMedicamentos");
    const mensagemEl = $("mensagemMedicamentos");
    const buscaEl = $("inputBusca");
    const contadorEl = $("contadorResultados");
    const btnNovo = $("btnNovo");

    const formEl = $("formMedicamento");
    const tituloFormEl = $("tituloForm");
    const erroFormEl = $("erroForm");
    const btnSalvar = $("btnSalvar");
    const selectUnidade = $("campoUnidade");

    const corpoDetalhes = $("corpoDetalhes");
    const btnDetEditar = $("btnDetEditar");
    const btnDetAlternar = $("btnDetAlternar");
    const btnDetExcluir = $("btnDetExcluir");

    const modalFormEl = $("modalForm");
    const modalDetalhesEl = $("modalDetalhes");
    const modalForm = new bootstrap.Modal(modalFormEl);
    const modalDetalhes = new bootstrap.Modal(modalDetalhesEl);

    // campo da API (snake_case) -> elemento do formulário
    const CAMPOS = {
        nome: $("campoNome"),
        laboratorio: $("campoLaboratorio"),
        principio_ativo: $("campoPrincipio"),
        concentracao: $("campoConcentracao"),
        unidade: selectUnidade,
        forma_farmaceutica: $("campoForma"),
        generico: $("campoGenerico"),
        validade: $("campoValidade"),
        observacoes: $("campoObservacoes")
    };

    let registros = [];
    let editandoUuid = null;
    let detalheUuid = null;
    let salvando = false;
    let focoAnterior = null;
    let detalheAcionado = false;
    const aberturaForm = rastrearAbertura(modalFormEl);
    const aberturaDetalhes = rastrearAbertura(modalDetalhesEl);

    /* ---------- utilidades ---------- */

    function el(tag, classe, texto) {
        const e = document.createElement(tag);
        if (classe) e.className = classe;
        if (texto !== undefined && texto !== null) e.textContent = texto;
        return e;
    }

    function normalizar(txt) {
        return String(txt || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    }

    function mostrarMensagem(texto, tipo) {
        mensagemEl.textContent = texto;
        mensagemEl.className = "alert alert-" + (tipo || "success");
        mensagemEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    function limparMensagem() {
        mensagemEl.textContent = "";
        mensagemEl.className = "alert d-none";
    }

    function rotuloGenerico(g) {
        return g === true ? "Sim" : g === false ? "Não" : "Não informado";
    }

    function concentracaoCompleta(m) {
        return m.concentracao ? m.concentracao + (m.unidade ? " " + m.unidade : "") : "";
    }

    function restaurarFoco() {
        const alvo = focoAnterior && document.body.contains(focoAnterior) && !focoAnterior.disabled ? focoAnterior : btnNovo;
        focoAnterior = null;
        if (alvo && typeof alvo.focus === "function") alvo.focus();
    }

    /** Acompanha se o modal ainda está na animação de abertura (o Bootstrap ignora hide() nesse intervalo). */
    function rastrearAbertura(el) {
        const estado = { abrindo: false };
        el.addEventListener("show.bs.modal", function () { estado.abrindo = true; });
        el.addEventListener("shown.bs.modal", function () { estado.abrindo = false; });
        el.addEventListener("hidden.bs.modal", function () { estado.abrindo = false; });
        return estado;
    }

    /** Fecha o modal com segurança; a Promise resolve quando ele estiver totalmente fechado. */
    function fecharModal(modal, el, estado) {
        return new Promise(function (resolve) {
            if (!el.classList.contains("show")) { resolve(); return; }
            const fechar = function () {
                el.addEventListener("hidden.bs.modal", function () { resolve(); }, { once: true });
                modal.hide();
            };
            if (estado.abrindo) el.addEventListener("shown.bs.modal", fechar, { once: true });
            else fechar();
        });
    }

    /**
     * Executa fn depois que o modal de detalhes fechar (evita modais empilhados).
     * Cliques repetidos enquanto a ação está pendente são ignorados (evita ação dupla).
     */
    function aposFecharDetalhes(fn) {
        if (detalheAcionado) return;
        detalheAcionado = true;
        fecharModal(modalDetalhes, modalDetalhesEl, aberturaDetalhes).then(function () {
            detalheAcionado = false;
            fn();
        });
    }

    /* ---------- listagem ---------- */

    function filtrar() {
        const termos = normalizar(buscaEl.value).split(/\s+/).filter(Boolean);
        if (termos.length === 0) return registros;
        return registros.filter(function (m) {
            const alvo = normalizar([m.nome, m.laboratorio, m.principio_ativo].join(" "));
            return termos.every(function (t) { return alvo.indexOf(t) >= 0; });
        });
    }

    function criarBadge(texto, classe) {
        return el("span", "badge " + classe, texto);
    }

    function criarCard(m) {
        const card = el("div", "medicamento-item");
        card.setAttribute("data-uuid", m.uuid);

        card.appendChild(el("div", "medicamento-nome", m.nome));

        const partes = [m.laboratorio, m.principio_ativo, concentracaoCompleta(m), m.forma_farmaceutica]
            .filter(function (p) { return p; });
        if (partes.length) card.appendChild(el("div", "medicamento-meta", partes.join(" · ")));

        const badges = el("div", "medicamento-badges");
        if (m.generico === true) badges.appendChild(criarBadge("Genérico", "text-bg-success"));
        if (m.generico === false) badges.appendChild(criarBadge("Não genérico", "text-bg-secondary"));
        if (m.validade) {
            const vencido = m.validade < S.hojeCivil();
            badges.appendChild(criarBadge(
                (vencido ? "Vencido em " : "Validade ") + S.formatarDataCivil(m.validade),
                vencido ? "text-bg-danger" : "text-bg-info"
            ));
        }
        if (m.origem === "importado") badges.appendChild(criarBadge("Importado", "text-bg-primary"));
        if (!m.editavel) badges.appendChild(criarBadge("Bloqueado", "text-bg-dark"));
        if (badges.childNodes.length) card.appendChild(badges);

        const acoes = el("div", "medicamento-acoes");

        const btnDetalhes = el("button", "btn btn-outline-secondary btn-sm", "Detalhes");
        btnDetalhes.type = "button";
        btnDetalhes.setAttribute("aria-label", "Ver detalhes de " + m.nome);
        btnDetalhes.addEventListener("click", function () { abrirDetalhes(m.uuid, btnDetalhes); });

        const btnEditar = el("button", "btn btn-outline-primary btn-sm", "Editar");
        btnEditar.type = "button";
        btnEditar.setAttribute("aria-label", "Editar " + m.nome);
        btnEditar.disabled = !m.editavel;
        if (!m.editavel) btnEditar.title = "Registro bloqueado para edição";
        btnEditar.addEventListener("click", function () { abrirFormulario(m, btnEditar); });

        const btnExcluir = el("button", "btn btn-outline-danger btn-sm", "Excluir");
        btnExcluir.type = "button";
        btnExcluir.setAttribute("aria-label", "Excluir " + m.nome);
        btnExcluir.disabled = !m.editavel;
        if (!m.editavel) btnExcluir.title = "Registro bloqueado para exclusão";
        btnExcluir.addEventListener("click", function () { confirmarExclusao(m, btnExcluir); });

        acoes.append(btnDetalhes, btnEditar, btnExcluir);
        card.appendChild(acoes);
        return card;
    }

    function renderizar() {
        listaEl.replaceChildren();
        const visiveis = filtrar();
        const buscando = buscaEl.value.trim() !== "";

        if (registros.length === 0) {
            listaEl.appendChild(el("div", "text-muted text-center py-4", "Nenhum medicamento cadastrado."));
            contadorEl.textContent = "";
            return;
        }
        if (visiveis.length === 0) {
            listaEl.appendChild(el("div", "text-muted text-center py-4", "Nenhum medicamento encontrado para a pesquisa."));
            contadorEl.textContent = "0 de " + registros.length + " medicamentos.";
            return;
        }
        visiveis.forEach(function (m) { listaEl.appendChild(criarCard(m)); });
        contadorEl.textContent = buscando
            ? visiveis.length + " de " + registros.length + (registros.length === 1 ? " medicamento." : " medicamentos.")
            : registros.length + (registros.length === 1 ? " medicamento cadastrado." : " medicamentos cadastrados.");
    }

    async function carregar() {
        const r = await S.listar();
        if (!r.ok) {
            registros = [];
            listaEl.replaceChildren(el("div", "text-muted text-center py-4", "Não foi possível carregar os medicamentos."));
            contadorEl.textContent = "";
            mostrarMensagem(r.erro.mensagem, "danger");
            if (r.erro.codigo === "SEM_SUPORTE") {
                btnNovo.disabled = true;
                buscaEl.disabled = true;
            }
            return false;
        }
        registros = r.data;
        renderizar();
        return true;
    }

    /* ---------- formulário ---------- */

    function limparErrosForm() {
        erroFormEl.textContent = "";
        erroFormEl.classList.add("d-none");
        Object.keys(CAMPOS).forEach(function (c) {
            CAMPOS[c].classList.remove("is-invalid");
            CAMPOS[c].removeAttribute("aria-invalid");
            const fb = $("erro-" + c);
            if (fb) fb.textContent = "";
        });
    }

    function mostrarErrosCampos(campos) {
        let primeiro = null;
        Object.keys(CAMPOS).forEach(function (c) {
            if (!campos[c]) return;
            CAMPOS[c].classList.add("is-invalid");
            CAMPOS[c].setAttribute("aria-invalid", "true");
            $("erro-" + c).textContent = campos[c];
            if (!primeiro) primeiro = CAMPOS[c];
        });
        if (primeiro) primeiro.focus();
    }

    function mostrarErroForm(texto) {
        erroFormEl.textContent = texto;
        erroFormEl.classList.remove("d-none");
    }

    function preencherFormulario(m) {
        CAMPOS.nome.value = m ? m.nome : "";
        CAMPOS.laboratorio.value = m && m.laboratorio ? m.laboratorio : "";
        CAMPOS.principio_ativo.value = m && m.principio_ativo ? m.principio_ativo : "";
        CAMPOS.concentracao.value = m && m.concentracao ? m.concentracao : "";
        CAMPOS.unidade.value = m && m.unidade ? m.unidade : "";
        CAMPOS.forma_farmaceutica.value = m && m.forma_farmaceutica ? m.forma_farmaceutica : "";
        CAMPOS.generico.value = m ? (m.generico === true ? "sim" : m.generico === false ? "nao" : "") : "";
        CAMPOS.validade.value = m && m.validade ? m.validade : "";
        CAMPOS.observacoes.value = m && m.observacoes ? m.observacoes : "";
    }

    function lerFormulario() {
        const g = CAMPOS.generico.value;
        return {
            nome: CAMPOS.nome.value,
            laboratorio: CAMPOS.laboratorio.value,
            principio_ativo: CAMPOS.principio_ativo.value,
            concentracao: CAMPOS.concentracao.value,
            unidade: CAMPOS.unidade.value,
            forma_farmaceutica: CAMPOS.forma_farmaceutica.value,
            generico: g === "sim" ? true : g === "nao" ? false : null,
            validade: CAMPOS.validade.value,
            observacoes: CAMPOS.observacoes.value
        };
    }

    function abrirFormulario(m, origemFoco) {
        focoAnterior = origemFoco || document.activeElement;
        limparMensagem();
        limparErrosForm();
        editandoUuid = m ? m.uuid : null;
        tituloFormEl.textContent = m ? "Editar medicamento" : "Novo medicamento";
        preencherFormulario(m);
        modalForm.show();
    }

    async function salvar(evento) {
        evento.preventDefault();
        if (salvando) return;
        limparErrosForm();

        const dados = lerFormulario();
        const v = S.validarEntrada(dados);
        if (!v.entrada) { mostrarErrosCampos(v.campos); return; }

        salvando = true;
        btnSalvar.disabled = true;
        try {
            const novo = editandoUuid === null;
            const r = novo ? await S.criar(dados) : await S.atualizar(editandoUuid, dados);

            if (!r.ok) {
                if (r.erro.codigo === "DADOS_INVALIDOS" && Object.keys(r.erro.campos || {}).length) {
                    mostrarErrosCampos(r.erro.campos);
                } else {
                    mostrarErroForm(r.erro.mensagem);
                    if (r.erro.codigo === "BLOQUEADO" || r.erro.codigo === "NAO_ENCONTRADO") await carregar();
                }
                return;
            }

            await fecharModal(modalForm, modalFormEl, aberturaForm);
            await carregar();
            mostrarMensagem(
                novo ? "Medicamento cadastrado com sucesso."
                    : r.alterado ? "Medicamento atualizado com sucesso."
                        : "Nenhuma alteração foi feita nos dados do medicamento.",
                novo || r.alterado ? "success" : "info"
            );
        } finally {
            salvando = false;
            btnSalvar.disabled = false;
        }
    }

    /* ---------- detalhes ---------- */

    function linhaDetalhe(dl, rotulo, valor, codigo) {
        dl.appendChild(el("dt", null, rotulo));
        const dd = el("dd");
        if (codigo) dd.appendChild(el("code", null, valor));
        else dd.textContent = valor;
        dl.appendChild(dd);
    }

    function renderizarDetalhes(m) {
        corpoDetalhes.replaceChildren();
        const dl = el("dl", "detalhes-medicamento");
        linhaDetalhe(dl, "Nome", m.nome);
        linhaDetalhe(dl, "Laboratório", m.laboratorio || "—");
        linhaDetalhe(dl, "Princípio ativo", m.principio_ativo || "—");
        linhaDetalhe(dl, "Concentração", concentracaoCompleta(m) || "—");
        linhaDetalhe(dl, "Forma farmacêutica", m.forma_farmaceutica || "—");
        linhaDetalhe(dl, "Genérico", rotuloGenerico(m.generico));
        linhaDetalhe(dl, "Validade", m.validade ? S.formatarDataCivil(m.validade) : "—");
        linhaDetalhe(dl, "Observações", m.observacoes || "—");
        linhaDetalhe(dl, "Origem", m.origem === "importado" ? "Importado" : "Cadastro local");
        linhaDetalhe(dl, "Permissão de edição", m.editavel ? "Edição permitida" : "Bloqueado para edição e exclusão");
        if (m.importado_em !== null && m.importado_em !== undefined)
            linhaDetalhe(dl, "Importado em", S.formatarDataHora(m.importado_em));
        linhaDetalhe(dl, "Criado em", S.formatarDataHora(m.criado_em));
        linhaDetalhe(dl, "Última atualização", S.formatarDataHora(m.atualizado_em));
        linhaDetalhe(dl, "UUID", m.uuid, true);
        corpoDetalhes.appendChild(dl);

        btnDetEditar.disabled = !m.editavel;
        btnDetExcluir.disabled = !m.editavel;
        btnDetAlternar.textContent = m.editavel ? "Bloquear edição" : "Permitir edição";
    }

    async function abrirDetalhes(uuid, origemFoco) {
        focoAnterior = origemFoco || document.activeElement;
        limparMensagem();
        const r = await S.buscarPorUuid(uuid);
        if (!r.ok) {
            mostrarMensagem(r.erro.mensagem, "danger");
            await carregar();
            return;
        }
        detalheUuid = uuid;
        renderizarDetalhes(r.data);
        modalDetalhes.show();
    }

    /* ---------- exclusão e permissão de edição ---------- */

    function confirmarExclusao(m, origemFoco) {
        focoAnterior = origemFoco || document.activeElement;
        window.solicitarConfirmacaoGlobal(
            "Deseja realmente excluir \"" + m.nome + "\"? Esta ação não pode ser desfeita.",
            async function () {
                const r = await S.excluir(m.uuid);
                await carregar();
                if (!r.ok) { mostrarMensagem(r.erro.mensagem, "danger"); return; }
                mostrarMensagem("Medicamento excluído.", "success");
                restaurarFoco();
            }
        );
    }

    async function alternarEditavel(uuid) {
        const r0 = await S.buscarPorUuid(uuid);
        if (!r0.ok) { mostrarMensagem(r0.erro.mensagem, "danger"); await carregar(); return; }
        const m = r0.data;
        const novoValor = !m.editavel;

        const aplicar = async function () {
            const r = await S.definirEditavel(uuid, novoValor);
            await carregar();
            if (!r.ok) { mostrarMensagem(r.erro.mensagem, "danger"); return; }
            mostrarMensagem(novoValor
                ? "Edição permitida para este medicamento."
                : "Edição e exclusão bloqueadas para este medicamento.", "success");
        };

        // Confirmação ao liberar um registro importado (ele vem bloqueado por padrão).
        if (novoValor && m.origem === "importado") {
            window.solicitarConfirmacaoGlobal(
                "Este medicamento foi importado e está protegido. Deseja permitir sua edição e exclusão?",
                aplicar
            );
        } else {
            aplicar();
        }
    }

    /* ---------- eventos ---------- */

    function iniciar() {
        S.UNIDADES.forEach(function (u) {
            const o = document.createElement("option");
            o.value = u;
            o.textContent = u;
            selectUnidade.appendChild(o);
        });

        btnNovo.addEventListener("click", function () { abrirFormulario(null, btnNovo); });
        formEl.addEventListener("submit", salvar);
        buscaEl.addEventListener("input", renderizar);

        modalFormEl.addEventListener("shown.bs.modal", function () { CAMPOS.nome.focus(); });
        modalFormEl.addEventListener("hidden.bs.modal", function () { editandoUuid = null; restaurarFoco(); });
        modalDetalhesEl.addEventListener("hidden.bs.modal", function () { detalheUuid = null; });

        btnDetEditar.addEventListener("click", async function () {
            const uuid = detalheUuid;
            aposFecharDetalhes(async function () {
                const r = await S.buscarPorUuid(uuid);
                if (!r.ok) { mostrarMensagem(r.erro.mensagem, "danger"); await carregar(); return; }
                if (!r.data.editavel) { mostrarMensagem("Este medicamento está bloqueado para edição.", "warning"); await carregar(); return; }
                abrirFormulario(r.data, btnNovo);
            });
        });
        btnDetAlternar.addEventListener("click", function () {
            const uuid = detalheUuid;
            aposFecharDetalhes(function () { alternarEditavel(uuid); });
        });
        btnDetExcluir.addEventListener("click", function () {
            const uuid = detalheUuid;
            aposFecharDetalhes(async function () {
                const r = await S.buscarPorUuid(uuid);
                if (!r.ok) { mostrarMensagem(r.erro.mensagem, "danger"); await carregar(); return; }
                confirmarExclusao(r.data, btnNovo);
            });
        });

        carregar();
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
    else iniciar();
})();
