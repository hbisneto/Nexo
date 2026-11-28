package com.bisneto.divergencias
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.SQLException
import android.database.sqlite.SQLiteConstraintException
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import java.util.UUID

class DatabaseHelper(context: Context) :
    SQLiteOpenHelper(
        context,
        DATABASE_NAME,
        null,
        DATABASE_VERSION
    ) {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE divergencias (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                codigo_produto TEXT,
                pdv TEXT,
                descricao TEXT,
                valor_original INTEGER NOT NULL,
                quantidade INTEGER NOT NULL,
                valor_promocional INTEGER NOT NULL,
                divergencia INTEGER NOT NULL,
                motivo TEXT,
                data_hora INTEGER NOT NULL
            )
            """.trimIndent()
        )

        db.execSQL(
            """
            CREATE TABLE funcionarios (
                cracha TEXT PRIMARY KEY,
                nome TEXT NOT NULL,
                cargo TEXT NOT NULL
            )
            """.trimIndent()
        )

        criarEstruturaMedicamentos(db)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 3) {
            db.execSQL(
                """
                CREATE TABLE IF NOT EXISTS funcionarios (
                    cracha TEXT PRIMARY KEY,
                    nome TEXT NOT NULL,
                    cargo TEXT NOT NULL
                )
                """.trimIndent()
            )
        }

        if (oldVersion < 4) {
            // Migração incremental: apenas adiciona o módulo de medicamentos.
            criarEstruturaMedicamentos(db)
        }
    }

    /* =========================================================
       DIVERGÊNCIAS (existente)
       ========================================================= */

    fun inserirDivergencia(
        codigoProduto: String,
        pdv: String,
        descricao: String,
        valorOriginal: Long,
        quantidade: Int,
        valorPromocional: Long,
        divergencia: Long,
        motivo: String
    ): Long {
        val db = writableDatabase
        val values = ContentValues().apply {
            put("codigo_produto", codigoProduto)
            put("pdv", pdv)
            put("descricao", descricao)
            put("valor_original", valorOriginal)
            put("quantidade", quantidade)
            put("valor_promocional", valorPromocional)
            put("divergencia", divergencia)
            put("motivo", motivo)
            put("data_hora", System.currentTimeMillis())
        }
        return db.insert("divergencias", null, values)
    }

    fun listarDivergencias(): List<Divergencia> {
        val lista = mutableListOf<Divergencia>()
        val db = readableDatabase
        val cursor = db.query(
            "divergencias",
            null, null, null, null, null,
            "data_hora DESC"
        )
        cursor.use {
            while (it.moveToNext()) {
                lista.add(
                    Divergencia(
                        id = it.getLong(it.getColumnIndexOrThrow("id")),
                        codigoProduto = it.getString(it.getColumnIndexOrThrow("codigo_produto")) ?: "",
                        pdv = it.getString(it.getColumnIndexOrThrow("pdv")) ?: "",
                        descricao = it.getString(it.getColumnIndexOrThrow("descricao")) ?: "",
                        valorOriginal = it.getLong(it.getColumnIndexOrThrow("valor_original")),
                        quantidade = it.getInt(it.getColumnIndexOrThrow("quantidade")),
                        valorPromocional = it.getLong(it.getColumnIndexOrThrow("valor_promocional")),
                        divergencia = it.getLong(it.getColumnIndexOrThrow("divergencia")),
                        motivo = it.getString(it.getColumnIndexOrThrow("motivo")) ?: "",
                        dataHora = it.getLong(it.getColumnIndexOrThrow("data_hora"))
                    )
                )
            }
        }
        return lista
    }

    fun atualizarDivergencia(
        id: Long,
        codigoProduto: String,
        pdv: String,
        descricao: String,
        valorOriginal: Long,
        quantidade: Int,
        valorPromocional: Long,
        divergencia: Long,
        motivo: String
    ): Int {
        val db = writableDatabase
        val values = ContentValues().apply {
            put("codigo_produto", codigoProduto)
            put("pdv", pdv)
            put("descricao", descricao)
            put("valor_original", valorOriginal)
            put("quantidade", quantidade)
            put("valor_promocional", valorPromocional)
            put("divergencia", divergencia)
            put("motivo", motivo)
            put("data_hora", System.currentTimeMillis())
        }
        return db.update("divergencias", values, "id = ?", arrayOf(id.toString()))
    }

    fun excluirDivergencia(id: Long): Int {
        val db = writableDatabase
        return db.delete("divergencias", "id = ?", arrayOf(id.toString()))
    }

    /* =========================================================
       FUNCIONÁRIOS (novo)
       ========================================================= */

    fun inserirFuncionario(cracha: String, nome: String, cargo: String): Boolean {
        val db = writableDatabase
        val values = ContentValues().apply {
            put("cracha", cracha.trim())
            put("nome", nome.trim())
            put("cargo", cargo.trim())
        }
        return try {
            db.insertWithOnConflict(
                "funcionarios",
                null,
                values,
                SQLiteDatabase.CONFLICT_REPLACE
            ) != -1L
        } catch (e: Exception) {
            false
        }
    }

    fun listarFuncionarios(): List<Map<String, String>> {
        val lista = mutableListOf<Map<String, String>>()
        val db = readableDatabase
        db.query(
            "funcionarios",
            null, null, null, null, null,
            "nome COLLATE NOCASE ASC"
        ).use { c ->
            while (c.moveToNext()) {
                lista.add(
                    mapOf(
                        "cracha" to (c.getString(c.getColumnIndexOrThrow("cracha")) ?: ""),
                        "nome" to (c.getString(c.getColumnIndexOrThrow("nome")) ?: ""),
                        "cargo" to (c.getString(c.getColumnIndexOrThrow("cargo")) ?: "")
                    )
                )
            }
        }
        return lista
    }

    fun excluirFuncionario(cracha: String): Int {
        val db = writableDatabase
        return db.delete("funcionarios", "cracha = ?", arrayOf(cracha.trim()))
    }

    fun buscarFuncionarioPorCracha(cracha: String): Map<String, String>? {
        val db = readableDatabase
        db.query(
            "funcionarios",
            null,
            "cracha = ?",
            arrayOf(cracha.trim()),
            null, null, null
        ).use { c ->
            if (c.moveToFirst()) {
                return mapOf(
                    "cracha" to (c.getString(c.getColumnIndexOrThrow("cracha")) ?: ""),
                    "nome" to (c.getString(c.getColumnIndexOrThrow("nome")) ?: ""),
                    "cargo" to (c.getString(c.getColumnIndexOrThrow("cargo")) ?: "")
                )
            }
        }
        return null
    }


    /* =========================================================
       MEDICAMENTOS
       - Toda regra de validação e autorização é aplicada aqui (e, para
         bloqueio/imutabilidade, também por triggers no próprio SQLite),
         e não apenas na interface.
       - Datas de auditoria: epoch em milissegundos (UTC).
       - "validade": data civil AAAA-MM-DD (TEXT), sem fuso horário.
       ========================================================= */

    private fun criarEstruturaMedicamentos(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS medicamentos (
                uuid TEXT PRIMARY KEY NOT NULL,
                nome TEXT NOT NULL CHECK (length(trim(nome)) > 0),
                laboratorio TEXT,
                principio_ativo TEXT,
                concentracao TEXT,
                unidade TEXT,
                forma_farmaceutica TEXT,
                generico INTEGER CHECK (generico IS NULL OR generico IN (0, 1)),
                validade TEXT,
                observacoes TEXT,
                origem TEXT NOT NULL CHECK (origem IN ('local', 'importado')),
                editavel INTEGER NOT NULL CHECK (editavel IN (0, 1)),
                criado_em INTEGER NOT NULL,
                atualizado_em INTEGER NOT NULL,
                importado_em INTEGER,
                CHECK (atualizado_em >= criado_em),
                CHECK (
                    (origem = 'local' AND importado_em IS NULL) OR
                    (origem = 'importado' AND importado_em IS NOT NULL)
                )
            )
            """.trimIndent()
        )
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_medicamentos_nome ON medicamentos (nome COLLATE NOCASE)")
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_medicamentos_atualizado ON medicamentos (atualizado_em)")

        // uuid, criado_em, origem e importado_em nunca mudam depois do cadastro.
        db.execSQL(
            """
            CREATE TRIGGER IF NOT EXISTS trg_medicamentos_imutaveis
            BEFORE UPDATE ON medicamentos
            WHEN NEW.uuid IS NOT OLD.uuid
              OR NEW.criado_em IS NOT OLD.criado_em
              OR NEW.origem IS NOT OLD.origem
              OR NEW.importado_em IS NOT OLD.importado_em
            BEGIN
                SELECT RAISE(ABORT, 'medicamento campo imutavel');
            END
            """.trimIndent()
        )
        // Registro bloqueado: só é possível mudar editavel (de 0 para 1), sem tocar nos dados.
        db.execSQL(
            """
            CREATE TRIGGER IF NOT EXISTS trg_medicamentos_bloqueio_update
            BEFORE UPDATE ON medicamentos
            WHEN OLD.editavel = 0 AND (
                NEW.editavel = 0
                OR NEW.nome IS NOT OLD.nome
                OR NEW.laboratorio IS NOT OLD.laboratorio
                OR NEW.principio_ativo IS NOT OLD.principio_ativo
                OR NEW.concentracao IS NOT OLD.concentracao
                OR NEW.unidade IS NOT OLD.unidade
                OR NEW.forma_farmaceutica IS NOT OLD.forma_farmaceutica
                OR NEW.generico IS NOT OLD.generico
                OR NEW.validade IS NOT OLD.validade
                OR NEW.observacoes IS NOT OLD.observacoes
                OR NEW.atualizado_em IS NOT OLD.atualizado_em
            )
            BEGIN
                SELECT RAISE(ABORT, 'medicamento bloqueado');
            END
            """.trimIndent()
        )
        db.execSQL(
            """
            CREATE TRIGGER IF NOT EXISTS trg_medicamentos_bloqueio_delete
            BEFORE DELETE ON medicamentos
            WHEN OLD.editavel = 0
            BEGIN
                SELECT RAISE(ABORT, 'medicamento bloqueado');
            END
            """.trimIndent()
        )
    }

    private fun cursorParaMedicamento(c: Cursor): Medicamento {
        fun texto(col: String): String? {
            val i = c.getColumnIndexOrThrow(col)
            return if (c.isNull(i)) null else c.getString(i)
        }
        val iGenerico = c.getColumnIndexOrThrow("generico")
        val iImportado = c.getColumnIndexOrThrow("importado_em")
        return Medicamento(
            uuid = c.getString(c.getColumnIndexOrThrow("uuid")),
            nome = c.getString(c.getColumnIndexOrThrow("nome")),
            laboratorio = texto("laboratorio"),
            principioAtivo = texto("principio_ativo"),
            concentracao = texto("concentracao"),
            unidade = texto("unidade"),
            formaFarmaceutica = texto("forma_farmaceutica"),
            generico = if (c.isNull(iGenerico)) null else c.getInt(iGenerico) == 1,
            validade = texto("validade"),
            observacoes = texto("observacoes"),
            origem = c.getString(c.getColumnIndexOrThrow("origem")),
            editavel = c.getInt(c.getColumnIndexOrThrow("editavel")) == 1,
            criadoEm = c.getLong(c.getColumnIndexOrThrow("criado_em")),
            atualizadoEm = c.getLong(c.getColumnIndexOrThrow("atualizado_em")),
            importadoEm = if (c.isNull(iImportado)) null else c.getLong(iImportado)
        )
    }

    private fun lerMedicamento(db: SQLiteDatabase, uuid: String): Medicamento? {
        db.query("medicamentos", null, "uuid = ?", arrayOf(uuid), null, null, null).use { c ->
            return if (c.moveToFirst()) cursorParaMedicamento(c) else null
        }
    }

    private fun valoresDeDados(e: MedicamentoEntrada): ContentValues = ContentValues().apply {
        put("nome", e.nome)
        put("laboratorio", e.laboratorio)
        put("principio_ativo", e.principioAtivo)
        put("concentracao", e.concentracao)
        put("unidade", e.unidade)
        put("forma_farmaceutica", e.formaFarmaceutica)
        if (e.generico == null) putNull("generico") else put("generico", if (e.generico) 1 else 0)
        put("validade", e.validade)
        put("observacoes", e.observacoes)
    }

    private fun <T> emTransacao(bloco: (SQLiteDatabase) -> MedicamentoResultado<T>): MedicamentoResultado<T> {
        val db = writableDatabase
        db.beginTransaction()
        return try {
            val resultado = bloco(db)
            if (resultado is MedicamentoResultado.Ok) db.setTransactionSuccessful()
            resultado
        } catch (e: SQLiteConstraintException) {
            val msg = e.message.orEmpty()
            when {
                msg.contains("medicamentos.uuid") ->
                    MedicamentoResultado.Falha(MedicamentoErro(MedicamentoErro.UUID_DUPLICADO, "Já existe um medicamento com este UUID."))
                msg.contains("medicamento bloqueado") ->
                    MedicamentoResultado.Falha(MedicamentoErro(MedicamentoErro.BLOQUEADO, "Este medicamento está bloqueado para edição e exclusão."))
                else ->
                    MedicamentoResultado.Falha(MedicamentoErro(MedicamentoErro.ERRO_BANCO, "O banco de dados recusou a operação."))
            }
        } catch (e: SQLException) {
            MedicamentoResultado.Falha(MedicamentoErro(MedicamentoErro.ERRO_BANCO, "Erro ao acessar o banco de dados."))
        } finally {
            db.endTransaction()
        }
    }

    private fun falha(codigo: String, mensagem: String, campos: Map<String, String> = emptyMap()) =
        MedicamentoResultado.Falha(MedicamentoErro(codigo, mensagem, campos))

    private val mensagemNaoEncontrado = "Medicamento não encontrado."
    private val mensagemBloqueado = "Este medicamento está bloqueado para edição e exclusão."

    /** Cadastro manual: gera UUID, origem=local, editavel=true e datas de criação/atualização. */
    fun inserirMedicamento(bruta: MedicamentoEntrada): MedicamentoResultado<Medicamento> {
        val validacao = MedicamentoValidator.validar(bruta)
        val e = validacao.entrada
            ?: return falha(MedicamentoErro.DADOS_INVALIDOS, "Verifique os campos informados.", validacao.campos)

        val agora = System.currentTimeMillis()
        val novo = Medicamento(
            uuid = UUID.randomUUID().toString(),
            nome = e.nome!!,
            laboratorio = e.laboratorio,
            principioAtivo = e.principioAtivo,
            concentracao = e.concentracao,
            unidade = e.unidade,
            formaFarmaceutica = e.formaFarmaceutica,
            generico = e.generico,
            validade = e.validade,
            observacoes = e.observacoes,
            origem = MedicamentoValidator.ORIGEM_LOCAL,
            editavel = true,
            criadoEm = agora,
            atualizadoEm = agora,
            importadoEm = null
        )

        return emTransacao { db ->
            val valores = valoresDeDados(e).apply {
                put("uuid", novo.uuid)
                put("origem", novo.origem)
                put("editavel", 1)
                put("criado_em", novo.criadoEm)
                put("atualizado_em", novo.atualizadoEm)
                putNull("importado_em")
            }
            db.insertOrThrow("medicamentos", null, valores)
            MedicamentoResultado.Ok(novo)
        }
    }

    fun listarMedicamentos(): List<Medicamento> {
        val lista = mutableListOf<Medicamento>()
        readableDatabase.query(
            "medicamentos", null, null, null, null, null,
            "nome COLLATE NOCASE ASC, criado_em ASC"
        ).use { c ->
            while (c.moveToNext()) lista.add(cursorParaMedicamento(c))
        }
        return lista
    }

    fun buscarMedicamentoPorUuid(uuid: String): Medicamento? = lerMedicamento(readableDatabase, uuid.trim())

    /**
     * Edição de dados. uuid, origem, criado_em e importado_em nunca são alterados.
     * Só atualiza atualizado_em quando algum dado realmente mudou.
     */
    fun atualizarMedicamento(uuid: String, bruta: MedicamentoEntrada): MedicamentoResultado<Medicamento> {
        val chave = uuid.trim()
        return emTransacao { db ->
            val atual = lerMedicamento(db, chave)
                ?: return@emTransacao falha(MedicamentoErro.NAO_ENCONTRADO, mensagemNaoEncontrado)
            if (!atual.editavel) return@emTransacao falha(MedicamentoErro.BLOQUEADO, mensagemBloqueado)

            val validacao = MedicamentoValidator.validar(bruta)
            val e = validacao.entrada
                ?: return@emTransacao falha(MedicamentoErro.DADOS_INVALIDOS, "Verifique os campos informados.", validacao.campos)

            val novo = atual.copy(
                nome = e.nome!!,
                laboratorio = e.laboratorio,
                principioAtivo = e.principioAtivo,
                concentracao = e.concentracao,
                unidade = e.unidade,
                formaFarmaceutica = e.formaFarmaceutica,
                generico = e.generico,
                validade = e.validade,
                observacoes = e.observacoes
            )
            if (novo == atual) return@emTransacao MedicamentoResultado.Ok(atual, alterado = false)

            val agora = maxOf(System.currentTimeMillis(), atual.atualizadoEm)
            val valores = valoresDeDados(e).apply { put("atualizado_em", agora) }
            val linhas = db.update("medicamentos", valores, "uuid = ? AND editavel = 1", arrayOf(chave))
            if (linhas == 0) return@emTransacao falha(MedicamentoErro.BLOQUEADO, mensagemBloqueado)

            MedicamentoResultado.Ok(novo.copy(atualizadoEm = agora))
        }
    }

    fun excluirMedicamento(uuid: String): MedicamentoResultado<Medicamento> {
        val chave = uuid.trim()
        return emTransacao { db ->
            val atual = lerMedicamento(db, chave)
                ?: return@emTransacao falha(MedicamentoErro.NAO_ENCONTRADO, mensagemNaoEncontrado)
            if (!atual.editavel) return@emTransacao falha(MedicamentoErro.BLOQUEADO, mensagemBloqueado)

            val linhas = db.delete("medicamentos", "uuid = ? AND editavel = 1", arrayOf(chave))
            if (linhas == 0) return@emTransacao falha(MedicamentoErro.BLOQUEADO, mensagemBloqueado)
            MedicamentoResultado.Ok(atual)
        }
    }

    /** Permite/bloqueia edição. Não altera nenhum outro campo, inclusive atualizado_em. */
    fun definirMedicamentoEditavel(uuid: String, editavel: Boolean): MedicamentoResultado<Medicamento> {
        val chave = uuid.trim()
        return emTransacao { db ->
            val atual = lerMedicamento(db, chave)
                ?: return@emTransacao falha(MedicamentoErro.NAO_ENCONTRADO, mensagemNaoEncontrado)
            if (atual.editavel == editavel) return@emTransacao MedicamentoResultado.Ok(atual, alterado = false)

            val valores = ContentValues().apply { put("editavel", if (editavel) 1 else 0) }
            db.update("medicamentos", valores, "uuid = ?", arrayOf(chave))
            MedicamentoResultado.Ok(atual.copy(editavel = editavel))
        }
    }

    companion object {
        private const val DATABASE_NAME = "divergencias.db"
        private const val DATABASE_VERSION = 4
    }

    fun substituirDadosBackup(
        funcionarios: JSONArray,
        divergencias: JSONArray
    ): Boolean {

        val db = writableDatabase

        db.beginTransaction()

        return try {

            db.delete("divergencias", null, null)
            db.delete("funcionarios", null, null)

            // Restaurar funcionários
            for (i in 0 until funcionarios.length()) {

                val item = funcionarios.getJSONObject(i)

                val values = ContentValues().apply {
                    put("cracha", item.getString("cracha"))
                    put("nome", item.getString("nome"))
                    put("cargo", item.getString("cargo"))
                }

                db.insertOrThrow("funcionarios", null, values)
            }

            // Restaurar divergências
            for (i in 0 until divergencias.length()) {

                val item = divergencias.getJSONObject(i)

                val values = ContentValues().apply {
                    put("id", item.getLong("id"))
                    put("codigo_produto", item.optString("codigoProduto"))
                    put("pdv", item.optString("pdv"))
                    put("descricao", item.optString("descricao"))
                    put("valor_original", item.getLong("valorOriginal"))
                    put("quantidade", item.getInt("quantidade"))
                    put("valor_promocional", item.getLong("valorPromocional"))
                    put("divergencia", item.getLong("divergencia"))
                    put("motivo", item.optString("motivo"))
                    put("data_hora", item.getLong("dataHora"))
                }

                db.insertOrThrow("divergencias", null, values)
            }

            db.setTransactionSuccessful()

            true

        } catch (e: Exception) {

            e.printStackTrace()
            false

        } finally {

            db.endTransaction()
        }
    }
}