/**
 * Medicamentos – camada de dados (Android/SQLite ou navegador/IndexedDB).
 *
 * - No app Android usa a bridge nativa "AndroidMedicamentos" (SQLite via Kotlin).
 * - Em qualquer outro ambiente (GitHub Pages, localhost) usa IndexedDB.
 *
 * Contrato (idêntico nos dois ambientes). Todas as funções devolvem uma Promise
 * que SEMPRE resolve (nunca rejeita) com:
 *   { ok: true,  data: <objeto|array>, alterado: <boolean> }
 *   { ok: false, erro: { codigo, mensagem, campos } }
 * Códigos: DADOS_INVALIDOS, NAO_ENCONTRADO, BLOQUEADO, UUID_DUPLICADO,
 *          ERRO_BANCO, SEM_SUPORTE, ERRO_BRIDGE.
 *
 * Os dados de cada ambiente são locais; não há sincronização.
 * As regras de validação espelham MedicamentoValidator (Medicamento.kt).
 */
(function (root) {
    "use strict";

    const DB_NAME = "nexo_medicamentos";
    const DB_VERSION = 2;
    const STORE = "medicamentos";

    const ORIGEM_LOCAL = "local";
    const ORIGEM_IMPORTADO = "importado";

    const UNIDADES = ["mg", "g", "mcg", "mL", "mg/mL", "mg/g", "mcg/mL", "UI", "%"];
    const LIMITES = {
        nome: 120,
        laboratorio: 120,
        principio_ativo: 200,
        forma_farmaceutica: 60,
        observacoes: 1000
    };
    const CAMPOS_TEXTO = ["nome", "laboratorio", "principio_ativo", "concentracao",
        "unidade", "forma_farmaceutica", "validade", "observacoes"];
    const CAMPOS_DADOS = CAMPOS_TEXTO.concat(["generico"]);

    const REGEX_CONCENTRACAO = /^\d{1,9}([.,]\d{1,6})?$/;
    const REGEX_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

    /* ---------- validação (espelha MedicamentoValidator) ---------- */

    function dataCivilValida(texto) {
        const m = REGEX_DATA.exec(texto);
        if (!m) return false;
        const ano = Number(m[1]), mes = Number(m[2]), dia = Number(m[3]);
        if (ano < 1900 || ano > 2200 || mes < 1 || mes > 12 || dia < 1) return false;
        const bissexto = (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
        const dias = [31, bissexto ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mes - 1];
        return dia <= dias;
    }

    /** Normaliza (trim, vazio -> null) e valida. Devolve { entrada, campos }. */
    function validarEntrada(bruta) {
        const origem = bruta && typeof bruta === "object" ? bruta : {};
        const campos = {};
        const v = {};

        CAMPOS_TEXTO.forEach(function (c) {
            const valor = origem[c];
            if (valor === undefined || valor === null) { v[c] = null; return; }
            if (typeof valor !== "string") { campos[c] = "Valor inválido."; v[c] = null; return; }
            const t = valor.trim();
            v[c] = t === "" ? null : t;
        });

        if (origem.generico === undefined || origem.generico === null) v.generico = null;
        else if (typeof origem.generico === "boolean") v.generico = origem.generico;
        else { campos.generico = "Valor inválido."; v.generico = null; }

        if (!campos.nome) {
            if (v.nome === null) campos.nome = "Informe o nome do medicamento.";
            else if (v.nome.length > LIMITES.nome) campos.nome = "O nome deve ter no máximo " + LIMITES.nome + " caracteres.";
        }
        if (!campos.laboratorio && v.laboratorio !== null && v.laboratorio.length > LIMITES.laboratorio)
            campos.laboratorio = "O laboratório deve ter no máximo " + LIMITES.laboratorio + " caracteres.";
        if (!campos.principio_ativo && v.principio_ativo !== null && v.principio_ativo.length > LIMITES.principio_ativo)
            campos.principio_ativo = "O princípio ativo deve ter no máximo " + LIMITES.principio_ativo + " caracteres.";
        if (!campos.forma_farmaceutica && v.forma_farmaceutica !== null && v.forma_farmaceutica.length > LIMITES.forma_farmaceutica)
            campos.forma_farmaceutica = "A forma farmacêutica deve ter no máximo " + LIMITES.forma_farmaceutica + " caracteres.";
        if (!campos.observacoes && v.observacoes !== null && v.observacoes.length > LIMITES.observacoes)
            campos.observacoes = "As observações devem ter no máximo " + LIMITES.observacoes + " caracteres.";

        if (!campos.concentracao && v.concentracao !== null && !REGEX_CONCENTRACAO.test(v.concentracao))
            campos.concentracao = "Use apenas números, com vírgula ou ponto decimal (ex.: 500 ou 2,5).";
        if (!campos.unidade && v.unidade !== null && UNIDADES.indexOf(v.unidade) < 0)
            campos.unidade = "Unidade inválida.";

        if (!campos.concentracao && !campos.unidade) {
            if (v.concentracao !== null && v.unidade === null) campos.unidade = "Informe a unidade da concentração.";
            else if (v.concentracao === null && v.unidade !== null) campos.concentracao = "Informe a concentração ou remova a unidade.";
        }

        if (!campos.validade && v.validade !== null && !dataCivilValida(v.validade))
            campos.validade = "Data de validade inválida.";

        if (Object.keys(campos).length > 0) return { entrada: null, campos: campos };
        return { entrada: v, campos: {} };
    }

    /* ---------- helpers de contrato ---------- */

    function ok(data, alterado) {
        return { ok: true, data: data, alterado: alterado !== false };
    }

    function falha(codigo, mensagem, campos) {
        return { ok: false, erro: { codigo: codigo, mensagem: mensagem, campos: campos || {} } };
    }

    const MSG_NAO_ENCONTRADO = "Medicamento não encontrado.";
    const MSG_BLOQUEADO = "Este medicamento está bloqueado para edição e exclusão.";
    const MSG_INVALIDO = "Verifique os campos informados.";

    function pegarDados(bruta) {
        const saida = {};
        const origem = bruta && typeof bruta === "object" ? bruta : {};
        CAMPOS_DADOS.forEach(function (c) { saida[c] = origem[c] === undefined ? null : origem[c]; });
        return saida;
    }

    function gerarUuid() {
        const c = root.crypto;
        if (c && typeof c.randomUUID === "function") return c.randomUUID();
        const b = new Uint8Array(16);
        if (c && typeof c.getRandomValues === "function") c.getRandomValues(b);
        else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
        b[6] = (b[6] & 0x0f) | 0x40;
        b[8] = (b[8] & 0x3f) | 0x80;
        const h = Array.prototype.map.call(b, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
        return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
    }

    function ordenar(lista) {
        const col = new Intl.Collator("pt-BR", { sensitivity: "base" });
        return lista.slice().sort(function (a, b) {
            return col.compare(a.nome, b.nome) || (a.criado_em - b.criado_em);
        });
    }

    /* =========================================================
       Backend Android (SQLite via AndroidMedicamentos)
       ========================================================= */

    function androidDisponivel() {
        try {
            return typeof root.AndroidMedicamentos !== "undefined" &&
                root.AndroidMedicamentos !== null &&
                typeof root.AndroidMedicamentos.isNative === "function" &&
                root.AndroidMedicamentos.isNative() === true;
        } catch (e) {
            return false;
        }
    }

    function chamarAndroid(metodo, args) {
        try {
            const bruto = root.AndroidMedicamentos[metodo].apply(root.AndroidMedicamentos, args || []);
            const resp = JSON.parse(bruto);
            if (!resp || typeof resp.ok !== "boolean") throw new Error("Resposta inválida da bridge.");
            return resp;
        } catch (e) {
            console.error("[Medicamentos] Falha na bridge Android:", metodo, e);
            return falha("ERRO_BRIDGE", "Não foi possível se comunicar com o banco de dados do aplicativo.");
        }
    }

    const backendAndroid = {
        listar: function () { return Promise.resolve(chamarAndroid("listar")); },
        buscarPorUuid: function (uuid) { return Promise.resolve(chamarAndroid("buscarPorUuid", [String(uuid)])); },
        criar: function (bruta) { return Promise.resolve(chamarAndroid("criar", [JSON.stringify(pegarDados(bruta))])); },
        atualizar: function (uuid, bruta) {
            return Promise.resolve(chamarAndroid("atualizar", [String(uuid), JSON.stringify(pegarDados(bruta))]));
        },
        excluir: function (uuid) { return Promise.resolve(chamarAndroid("excluir", [String(uuid)])); },
        definirEditavel: function (uuid, editavel) {
            if (typeof editavel !== "boolean") return Promise.resolve(falha("DADOS_INVALIDOS", "Valor inválido."));
            return Promise.resolve(chamarAndroid("definirEditavel", [String(uuid), editavel]));
        }
    };

    /* =========================================================
       Backend web (IndexedDB)
       ========================================================= */

    let dbPromise = null;

    function erroSemSuporte() {
        return falha("SEM_SUPORTE", "Este navegador não oferece suporte ao armazenamento local (IndexedDB) ou ele está bloqueado. " +
            "Verifique se não está em navegação privada e se o armazenamento do site é permitido.");
    }

    function erroBanco(detalhe) {
        if (detalhe) console.error("[Medicamentos] Erro IndexedDB:", detalhe);
        const quota = detalhe && detalhe.name === "QuotaExceededError";
        return falha("ERRO_BANCO", quota
            ? "O armazenamento do navegador está cheio. Libere espaço e tente novamente."
            : "Ocorreu um erro ao acessar o armazenamento local do navegador.");
    }

    function abrirBanco() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise(function (resolve, reject) {
            const idb = root.indexedDB;
            if (!idb) { reject(erroSemSuporte()); return; }
            let req;
            try {
                req = idb.open(DB_NAME, DB_VERSION);
            } catch (e) {
                reject(erroSemSuporte());
                return;
            }
            // Migrações incrementais: cada versão só acrescenta, nunca apaga dados.
            req.onupgradeneeded = function (ev) {
                const db = req.result;

                let destino;

                if (!db.objectStoreNames.contains(STORE)) {
                    destino = db.createObjectStore(STORE, {
                        keyPath: "uuid"
                    });

                    destino.createIndex("por_nome", "nome", { unique: false });
                    destino.createIndex("por_atualizado_em", "atualizado_em", { unique: false });
                    destino.createIndex("por_origem", "origem", { unique: false });
                } else {
                    destino = req.transaction.objectStore(STORE);
                }

                if (
                    ev.oldVersion < 2 &&
                    db.objectStoreNames.contains("produtos")
                ) {
                    const origem = req.transaction.objectStore("produtos");
                    const cursor = origem.openCursor();

                    cursor.onsuccess = function () {
                        const item = cursor.result;
                        if (!item) return;

                        const antigo = item.value;

                        destino.put({
                            uuid: antigo.uuid,
                            nome: antigo.nome || null,
                            laboratorio: antigo.laboratorio || null,
                            principio_ativo: antigo.principio || null,
                            concentracao: antigo.concentracao == null
                                ? null
                                : String(antigo.concentracao),
                            unidade: antigo.unidade || null,
                            forma_farmaceutica: antigo.tipo || null,
                            validade: antigo.validade || null,
                            observacoes: antigo.uso || null,
                            generico: null,
                            origem: "local",
                            editavel: antigo.editavel !== false,
                            criado_em: Date.parse(antigo.criadoEm) || Date.now(),
                            atualizado_em: Date.parse(antigo.atualizadoEm) || Date.now()
                        });

                        item.continue();
                    };
                }
            };
            req.onsuccess = function () {
                const db = req.result;
                db.onversionchange = function () { db.close(); dbPromise = null; };
                resolve(db);
            };
            req.onerror = function () { reject(erroBanco(req.error)); };
            req.onblocked = function () {
                reject(falha("ERRO_BANCO", "O banco de dados está bloqueado por outra aba aberta do Nexo. Feche as outras abas e recarregue."));
            };
        });
        dbPromise.catch(function () { dbPromise = null; });
        return dbPromise;
    }

    /**
     * Executa fn(store, definir) numa única transação. O resultado informado via
     * definir() só é devolvido quando a transação conclui (commit) com sucesso.
     */
    function transacao(modo, fn) {
        return abrirBanco().then(function (db) {
            return new Promise(function (resolve) {
                let tx;
                try {
                    tx = db.transaction(STORE, modo);
                } catch (e) {
                    resolve(erroBanco(e));
                    return;
                }
                let resultado = null;
                const definir = function (r) { resultado = r; };
                tx.oncomplete = function () { resolve(resultado || erroBanco(null)); };
                tx.onabort = function () { resolve(resultado && !resultado.ok ? resultado : erroBanco(tx.error)); };
                tx.onerror = function () { /* o abort subsequente resolve */ };
                try {
                    fn(tx.objectStore(STORE), definir);
                } catch (e) {
                    try { tx.abort(); } catch (_) { /* já finalizada */ }
                    resolve(erroBanco(e));
                }
            });
        }).catch(function (erro) {
            return erro && erro.ok === false ? erro : erroBanco(erro);
        });
    }

    function iguaisDados(a, b) {
        return CAMPOS_DADOS.every(function (c) { return a[c] === b[c]; });
    }

    const backendWeb = {
        listar: function () {
            return transacao("readonly", function (store, definir) {
                const r = store.getAll();
                r.onsuccess = function () { definir(ok(ordenar(r.result || []))); };
            });
        },

        buscarPorUuid: function (uuid) {
            return transacao("readonly", function (store, definir) {
                const r = store.get(String(uuid));
                r.onsuccess = function () {
                    definir(r.result ? ok(r.result) : falha("NAO_ENCONTRADO", MSG_NAO_ENCONTRADO));
                };
            });
        },

        /** Cadastro manual: UUID, origem=local, editavel=true, criado_em = atualizado_em. */
        criar: function (bruta) {
            const v = validarEntrada(pegarDados(bruta));
            if (!v.entrada) return Promise.resolve(falha("DADOS_INVALIDOS", MSG_INVALIDO, v.campos));
            const agora = Date.now();
            const registro = Object.assign({}, v.entrada, {
                uuid: gerarUuid(),
                origem: ORIGEM_LOCAL,
                editavel: true,
                criado_em: agora,
                atualizado_em: agora,
                importado_em: null
            });
            return transacao("readwrite", function (store, definir) {
                const r = store.add(registro);
                r.onsuccess = function () { definir(ok(registro)); };
                r.onerror = function (ev) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    if (r.error && r.error.name === "ConstraintError")
                        definir(falha("UUID_DUPLICADO", "Já existe um medicamento com este UUID."));
                    else
                        definir(erroBanco(r.error));
                };
            });
        },

        /**
         * Edição: uuid, origem, criado_em e importado_em vêm sempre do registro
         * existente. atualizado_em só muda se algum dado realmente mudou.
         */
        atualizar: function (uuid, bruta) {
            const dados = pegarDados(bruta);
            return transacao("readwrite", function (store, definir) {
                const g = store.get(String(uuid));
                g.onsuccess = function () {
                    const atual = g.result;
                    if (!atual) { definir(falha("NAO_ENCONTRADO", MSG_NAO_ENCONTRADO)); return; }
                    if (atual.editavel !== true) { definir(falha("BLOQUEADO", MSG_BLOQUEADO)); return; }
                    const v = validarEntrada(dados);
                    if (!v.entrada) { definir(falha("DADOS_INVALIDOS", MSG_INVALIDO, v.campos)); return; }

                    const novo = Object.assign({}, atual, v.entrada);
                    if (iguaisDados(novo, atual)) { definir(ok(atual, false)); return; }
                    novo.atualizado_em = Math.max(Date.now(), atual.atualizado_em);
                    const p = store.put(novo);
                    p.onsuccess = function () { definir(ok(novo)); };
                };
            });
        },

        excluir: function (uuid) {
            return transacao("readwrite", function (store, definir) {
                const g = store.get(String(uuid));
                g.onsuccess = function () {
                    const atual = g.result;
                    if (!atual) { definir(falha("NAO_ENCONTRADO", MSG_NAO_ENCONTRADO)); return; }
                    if (atual.editavel !== true) { definir(falha("BLOQUEADO", MSG_BLOQUEADO)); return; }
                    const d = store.delete(atual.uuid);
                    d.onsuccess = function () { definir(ok(atual)); };
                };
            });
        },

        /** Só muda "editavel"; atualizado_em e demais campos permanecem intactos. */
        definirEditavel: function (uuid, editavel) {
            if (typeof editavel !== "boolean") return Promise.resolve(falha("DADOS_INVALIDOS", "Valor inválido."));
            return transacao("readwrite", function (store, definir) {
                const g = store.get(String(uuid));
                g.onsuccess = function () {
                    const atual = g.result;
                    if (!atual) { definir(falha("NAO_ENCONTRADO", MSG_NAO_ENCONTRADO)); return; }
                    if (atual.editavel === editavel) { definir(ok(atual, false)); return; }
                    const novo = Object.assign({}, atual, { editavel: editavel });
                    const p = store.put(novo);
                    p.onsuccess = function () { definir(ok(novo)); };
                };
            });
        }
    };

    /* ---------- formatação ---------- */

    /** "2026-03-05" -> "05/03/2026" (sem usar Date: sem deslocamento de fuso). */
    function formatarDataCivil(texto) {
        const m = typeof texto === "string" ? REGEX_DATA.exec(texto) : null;
        return m ? m[3] + "/" + m[2] + "/" + m[1] : "";
    }

    /** Epoch ms (UTC) -> data e hora no fuso e formato locais. */
    function formatarDataHora(ms) {
        if (typeof ms !== "number" || !isFinite(ms)) return "";
        return new Intl.DateTimeFormat("pt-BR", {
            day: "2-digit", month: "2-digit", year: "numeric",
            hour: "2-digit", minute: "2-digit", second: "2-digit"
        }).format(new Date(ms));
    }

    /** Data civil de hoje no fuso local, "AAAA-MM-DD". */
    function hojeCivil() {
        const d = new Date();
        const p = function (n) { return (n < 10 ? "0" : "") + n; };
        return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
    }

    /* ---------- API pública ---------- */

    function backend() { return androidDisponivel() ? backendAndroid : backendWeb; }

    const api = {
        ambiente: function () { return androidDisponivel() ? "android" : "web"; },
        listar: function () { return backend().listar(); },
        buscarPorUuid: function (uuid) { return backend().buscarPorUuid(uuid); },
        criar: function (dados) { return backend().criar(dados); },
        atualizar: function (uuid, dados) { return backend().atualizar(uuid, dados); },
        excluir: function (uuid) { return backend().excluir(uuid); },
        definirEditavel: function (uuid, editavel) { return backend().definirEditavel(uuid, editavel); },
        validarEntrada: validarEntrada,
        dataCivilValida: dataCivilValida,
        formatarDataCivil: formatarDataCivil,
        formatarDataHora: formatarDataHora,
        hojeCivil: hojeCivil,
        UNIDADES: UNIDADES,
        LIMITES: LIMITES,
        ORIGEM_LOCAL: ORIGEM_LOCAL,
        ORIGEM_IMPORTADO: ORIGEM_IMPORTADO,
        /* Uso exclusivo em testes: força o backend IndexedDB, mesmo com bridge presente. */
        _backendWeb: backendWeb
    };

    root.NexoMedicamentos = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
