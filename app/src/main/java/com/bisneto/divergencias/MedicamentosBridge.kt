package com.bisneto.divergencias

import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * Bridge JS <-> Kotlin do módulo de Medicamentos (exposta como "AndroidMedicamentos").
 *
 * Contrato: todo método devolve uma String JSON.
 *   sucesso: {"ok":true,"data":<objeto|array>,"alterado":<boolean>}
 *   falha:   {"ok":false,"erro":{"codigo":"...","mensagem":"...","campos":{"campo":"mensagem"}}}
 *
 * Campos do medicamento (snake_case): uuid, nome, laboratorio, principio_ativo,
 * concentracao, unidade, forma_farmaceutica, generico (true/false/null), validade
 * ("AAAA-MM-DD"), observacoes, origem, editavel, criado_em, atualizado_em (epoch ms UTC),
 * importado_em (epoch ms UTC ou null).
 *
 * Toda autorização e validação é feita pelo DatabaseHelper; esta classe só traduz o contrato.
 * Campos imutáveis (uuid, origem, criado_em, ...) enviados no JSON de entrada são ignorados.
 */
class MedicamentosBridge(private val database: DatabaseHelper) {

    @JavascriptInterface
    fun isNative(): Boolean = true

    @JavascriptInterface
    fun listar(): String = executar {
        val array = JSONArray()
        database.listarMedicamentos().forEach { array.put(paraJson(it)) }
        ok(array)
    }

    @JavascriptInterface
    fun buscarPorUuid(uuid: String): String = executar {
        val m = database.buscarMedicamentoPorUuid(uuid)
        if (m == null) {
            falha(MedicamentoErro(MedicamentoErro.NAO_ENCONTRADO, "Medicamento não encontrado."))
        } else {
            ok(paraJson(m))
        }
    }

    @JavascriptInterface
    fun criar(json: String): String = executar {
        val entrada = lerEntrada(json) ?: return@executar entradaIlegivel()
        resposta(database.inserirMedicamento(entrada))
    }

    @JavascriptInterface
    fun atualizar(uuid: String, json: String): String = executar {
        val entrada = lerEntrada(json) ?: return@executar entradaIlegivel()
        resposta(database.atualizarMedicamento(uuid, entrada))
    }

    @JavascriptInterface
    fun excluir(uuid: String): String = executar {
        resposta(database.excluirMedicamento(uuid))
    }

    @JavascriptInterface
    fun definirEditavel(uuid: String, editavel: Boolean): String = executar {
        resposta(database.definirMedicamentoEditavel(uuid, editavel))
    }

    /* ---------- helpers ---------- */

    private fun executar(bloco: () -> String): String =
        try {
            bloco()
        } catch (e: Exception) {
            falha(MedicamentoErro(MedicamentoErro.ERRO_BANCO, "Erro inesperado ao processar a operação."))
        }

    private fun resposta(r: MedicamentoResultado<Medicamento>): String = when (r) {
        is MedicamentoResultado.Ok -> ok(paraJson(r.valor), r.alterado)
        is MedicamentoResultado.Falha -> falha(r.erro)
    }

    private fun ok(data: Any, alterado: Boolean = true): String =
        JSONObject().put("ok", true).put("data", data).put("alterado", alterado).toString()

    private fun falha(erro: MedicamentoErro): String {
        val campos = JSONObject()
        erro.campos.forEach { (k, v) -> campos.put(k, v) }
        val e = JSONObject()
            .put("codigo", erro.codigo)
            .put("mensagem", erro.mensagem)
            .put("campos", campos)
        return JSONObject().put("ok", false).put("erro", e).toString()
    }

    private fun entradaIlegivel(): String =
        falha(MedicamentoErro(MedicamentoErro.DADOS_INVALIDOS, "Os dados enviados são inválidos."))

    /** Converte o JSON de entrada; devolve null se a estrutura/tipos forem inválidos. */
    private fun lerEntrada(json: String): MedicamentoEntrada? = try {
        val o = JSONObject(json)
        MedicamentoEntrada(
            nome = o.textoOuNulo("nome"),
            laboratorio = o.textoOuNulo("laboratorio"),
            principioAtivo = o.textoOuNulo("principio_ativo"),
            concentracao = o.textoOuNulo("concentracao"),
            unidade = o.textoOuNulo("unidade"),
            formaFarmaceutica = o.textoOuNulo("forma_farmaceutica"),
            generico = o.booleanoOuNulo("generico"),
            validade = o.textoOuNulo("validade"),
            observacoes = o.textoOuNulo("observacoes")
        )
    } catch (e: JSONException) {
        null
    }

    // optString() devolve a string "null" para JSON null no Android; por isso estes helpers.
    private fun JSONObject.textoOuNulo(chave: String): String? {
        if (isNull(chave)) return null
        val v = get(chave)
        if (v is String) return v
        throw JSONException("O campo $chave deve ser texto.")
    }

    private fun JSONObject.booleanoOuNulo(chave: String): Boolean? {
        if (isNull(chave)) return null
        val v = get(chave)
        if (v is Boolean) return v
        throw JSONException("O campo $chave deve ser booleano.")
    }

    private fun paraJson(m: Medicamento): JSONObject = JSONObject()
        .put("uuid", m.uuid)
        .put("nome", m.nome)
        .put("laboratorio", m.laboratorio ?: JSONObject.NULL)
        .put("principio_ativo", m.principioAtivo ?: JSONObject.NULL)
        .put("concentracao", m.concentracao ?: JSONObject.NULL)
        .put("unidade", m.unidade ?: JSONObject.NULL)
        .put("forma_farmaceutica", m.formaFarmaceutica ?: JSONObject.NULL)
        .put("generico", m.generico ?: JSONObject.NULL)
        .put("validade", m.validade ?: JSONObject.NULL)
        .put("observacoes", m.observacoes ?: JSONObject.NULL)
        .put("origem", m.origem)
        .put("editavel", m.editavel)
        .put("criado_em", m.criadoEm)
        .put("atualizado_em", m.atualizadoEm)
        .put("importado_em", m.importadoEm ?: JSONObject.NULL)
}
