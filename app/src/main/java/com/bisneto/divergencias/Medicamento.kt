package com.bisneto.divergencias

/**
 * Modelo e regras de validação do módulo de Medicamentos.
 *
 * Este arquivo não depende de APIs do Android, para que as regras possam ser
 * reutilizadas pelo DatabaseHelper (camada de persistência) e pela bridge.
 * As mesmas regras estão espelhadas em assets/js/medicamentos-store.js.
 */

/** Registro completo, como persistido. Datas de auditoria em epoch ms (UTC). */
data class Medicamento(
    val uuid: String,
    val nome: String,
    val laboratorio: String?,
    val principioAtivo: String?,
    val concentracao: String?,
    val unidade: String?,
    val formaFarmaceutica: String?,
    val generico: Boolean?,          // true = sim, false = não, null = não informado
    val validade: String?,           // data civil "AAAA-MM-DD", sem fuso
    val observacoes: String?,
    val origem: String,              // "local" ou "importado"
    val editavel: Boolean,
    val criadoEm: Long,
    val atualizadoEm: Long,
    val importadoEm: Long?
)

/** Somente os campos que o usuário pode informar/alterar. */
data class MedicamentoEntrada(
    val nome: String?,
    val laboratorio: String?,
    val principioAtivo: String?,
    val concentracao: String?,
    val unidade: String?,
    val formaFarmaceutica: String?,
    val generico: Boolean?,
    val validade: String?,
    val observacoes: String?
)

/** Erro de domínio devolvido pela camada de dados. */
data class MedicamentoErro(
    val codigo: String,
    val mensagem: String,
    val campos: Map<String, String> = emptyMap()
) {
    companion object {
        const val DADOS_INVALIDOS = "DADOS_INVALIDOS"
        const val NAO_ENCONTRADO = "NAO_ENCONTRADO"
        const val BLOQUEADO = "BLOQUEADO"
        const val UUID_DUPLICADO = "UUID_DUPLICADO"
        const val ERRO_BANCO = "ERRO_BANCO"
    }
}

sealed class MedicamentoResultado<out T> {
    /** [alterado] é false quando a edição não mudou nenhum dado (atualizado_em preservado). */
    data class Ok<T>(val valor: T, val alterado: Boolean = true) : MedicamentoResultado<T>()
    data class Falha(val erro: MedicamentoErro) : MedicamentoResultado<Nothing>()
}

object MedicamentoValidator {
    const val ORIGEM_LOCAL = "local"
    const val ORIGEM_IMPORTADO = "importado"

    const val MAX_NOME = 120
    const val MAX_LABORATORIO = 120
    const val MAX_PRINCIPIO_ATIVO = 200
    const val MAX_FORMA = 60
    const val MAX_OBSERVACOES = 1000
    const val MAX_CONCENTRACAO = 12

    val UNIDADES = listOf("mg", "g", "mcg", "mL", "mg/mL", "mg/g", "mcg/mL", "UI", "%")

    private val REGEX_CONCENTRACAO = Regex("^\\d{1,9}([.,]\\d{1,6})?$")
    private val REGEX_DATA = Regex("^(\\d{4})-(\\d{2})-(\\d{2})$")

    class Resultado(val entrada: MedicamentoEntrada?, val campos: Map<String, String>) {
        val valido: Boolean get() = campos.isEmpty()
    }

    /** Normaliza (trim, vazio -> null) e valida. Nunca lança exceção. */
    fun validar(bruta: MedicamentoEntrada): Resultado {
        val erros = linkedMapOf<String, String>()

        val nome = bruta.nome.limpo()
        val laboratorio = bruta.laboratorio.limpo()
        val principio = bruta.principioAtivo.limpo()
        val concentracao = bruta.concentracao.limpo()
        val unidade = bruta.unidade.limpo()
        val forma = bruta.formaFarmaceutica.limpo()
        val validade = bruta.validade.limpo()
        val observacoes = bruta.observacoes.limpo()

        if (nome == null) erros["nome"] = "Informe o nome do medicamento."
        else if (nome.length > MAX_NOME) erros["nome"] = "O nome deve ter no máximo $MAX_NOME caracteres."

        if (laboratorio != null && laboratorio.length > MAX_LABORATORIO)
            erros["laboratorio"] = "O laboratório deve ter no máximo $MAX_LABORATORIO caracteres."

        if (principio != null && principio.length > MAX_PRINCIPIO_ATIVO)
            erros["principio_ativo"] = "O princípio ativo deve ter no máximo $MAX_PRINCIPIO_ATIVO caracteres."

        if (forma != null && forma.length > MAX_FORMA)
            erros["forma_farmaceutica"] = "A forma farmacêutica deve ter no máximo $MAX_FORMA caracteres."

        if (observacoes != null && observacoes.length > MAX_OBSERVACOES)
            erros["observacoes"] = "As observações devem ter no máximo $MAX_OBSERVACOES caracteres."

        if (concentracao != null && !REGEX_CONCENTRACAO.matches(concentracao))
            erros["concentracao"] = "Use apenas números, com vírgula ou ponto decimal (ex.: 500 ou 2,5)."

        if (unidade != null && unidade !in UNIDADES)
            erros["unidade"] = "Unidade inválida."

        if (!erros.containsKey("concentracao") && !erros.containsKey("unidade")) {
            if (concentracao != null && unidade == null)
                erros["unidade"] = "Informe a unidade da concentração."
            else if (concentracao == null && unidade != null)
                erros["concentracao"] = "Informe a concentração ou remova a unidade."
        }

        if (validade != null && !dataCivilValida(validade))
            erros["validade"] = "Data de validade inválida."

        if (erros.isNotEmpty()) return Resultado(null, erros)

        return Resultado(
            MedicamentoEntrada(nome, laboratorio, principio, concentracao, unidade, forma, bruta.generico, validade, observacoes),
            emptyMap()
        )
    }

    /** Valida "AAAA-MM-DD" como data de calendário real, sem usar fuso horário. */
    fun dataCivilValida(texto: String): Boolean {
        val m = REGEX_DATA.matchEntire(texto) ?: return false
        val ano = m.groupValues[1].toInt()
        val mes = m.groupValues[2].toInt()
        val dia = m.groupValues[3].toInt()
        if (ano < 1900 || ano > 2200 || mes < 1 || mes > 12 || dia < 1) return false
        val bissexto = (ano % 4 == 0 && ano % 100 != 0) || ano % 400 == 0
        val diasNoMes = when (mes) {
            2 -> if (bissexto) 29 else 28
            4, 6, 9, 11 -> 30
            else -> 31
        }
        return dia <= diasNoMes
    }

    private fun String?.limpo(): String? {
        val t = this?.trim()
        return if (t.isNullOrEmpty()) null else t
    }
}
