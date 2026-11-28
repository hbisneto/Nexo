const $=id=>document.getElementById(id);
let db,editId=null,items=[];

// const fields=['nome','concentracao','laboratorio','tipo','validade'];

const fields = [
    'nome',
    'principio',
    'concentracao',
    'unidade',
    'laboratorio',
    'tipo',
    'uso',
    'validade'
];

const req=r=>new Promise((ok,no)=>{r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)});
async function openDB(){return new Promise((ok,no)=>{let r=indexedDB.open('nexo_medicamentos',1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('produtos'))r.result.createObjectStore('produtos',{keyPath:'uuid'})};r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)})}
function store(mode){return db.transaction('produtos',mode).objectStore('produtos')}

async function render() {
    items = await req(store('readonly').getAll());

    const q = $('busca').value.toLowerCase().trim();
    $('lista').replaceChildren();

    const filtrados = items.filter(x =>
        [
            x.nome,
            x.principio,
            x.laboratorio,
            x.tipo
        ].some(valor =>
            (valor || '').toLowerCase().includes(q)
        )
    );

    if (filtrados.length === 0) {
        const vazio = document.createElement('div');
        vazio.className = 'medicamentos-vazio';
        vazio.textContent = items.length === 0
            ? 'Nenhum medicamento cadastrado ainda.'
            : 'Nenhum medicamento encontrado.';
        $('lista').append(vazio);
        return;
    }

    for (const x of filtrados) {
        // Card do medicamento
        const a = document.createElement('article');
        a.className = 'medicamento-card';

        // Nome
        const h = document.createElement('h3');
        h.textContent = x.nome;
        a.append(h);

        // Informações
        // Princípio ativo
        const principio = document.createElement('p');
        principio.className = 'medicamento-principio';
        principio.textContent = x.principio
            ? `Princípio ativo: ${x.principio}`
            : 'Princípio ativo não informado';

        a.append(principio);

        // Validade
        const validade = document.createElement('p');
        validade.className = 'medicamento-validade';

        validade.textContent = x.validade
            ? `Validade: ${x.validade}`
            : 'Validade não informada';

        a.append(validade);

        // Concentração, unidade, tipo e laboratório
        const d = document.createElement('p');
        d.className = 'medicamento-detalhes';

        const concentracao = [
            x.concentracao,
            x.unidade
        ].filter(Boolean).join(' ');

        d.textContent = [
            concentracao,
            x.tipo,
            x.laboratorio
        ].filter(Boolean).join(' · ');

        a.append(d);

        // Uso do medicamento
        const uso = document.createElement('p');
        uso.className = 'medicamento-uso';
        uso.textContent = x.uso
            // ? `Uso: ${x.uso}`
            ? `${x.uso}`
            : 'Uso não informado';

        a.append(uso);

        // Ações
        const acoes = document.createElement('div');
        acoes.className = 'medicamento-acoes';

        // Botão editar
        const editar = document.createElement('button');
        editar.className = 'btn btn-outline-danger btn-sm';
        editar.textContent = 'Editar';

        editar.onclick = () => {
            editId = x.uuid;
            $('cadastro').querySelector('[type="submit"]').textContent = 'Atualizar produto';

            fields.forEach(f => {
                $(f).value = x[f] || '';
            });

            $('nome').focus();

            $('cadastro').scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        };

        // Botão excluir
        const excluir = document.createElement('button');
        excluir.className = 'btn btn-danger btn-sm';
        excluir.textContent = 'Excluir';

        excluir.onclick = async () => {
            if (confirm(`Deseja excluir "${x.nome}"?`)) {
                await req(store('readwrite').delete(x.uuid));

                if (editId === x.uuid) {
                    editId = null;
                    $('cadastro').reset();
                }

                await render();
            }
        };

        acoes.append(editar, excluir);
        a.append(acoes);

        $('lista').append(a);
    }
}

$('cadastro').onsubmit = async e => {
    e.preventDefault();

    const old = items.find(x => x.uuid === editId);
    const now = new Date().toISOString();

    const x = {
        uuid: editId || crypto.randomUUID(),
        origem: old?.origem || 'web',
        criadoEm: old?.criadoEm || now,
        atualizadoEm: now,
        editavel: true
    };

    fields.forEach(f => {
        x[f] = $(f).value.trim();
    });

    x.concentracao = x.concentracao === ''
        ? null
        : Number(x.concentracao);

    await req(store('readwrite').put(x));

    editId = null;
    $('cadastro').reset();

    $('cadastro').querySelector('[type="submit"]').textContent =
        'Salvar produto';

    await render();
};

$('busca').oninput=()=>render();
openDB().then(x=>{
    db=x;
    return render()
}).catch(e=>{
        $('status').textContent='Não foi possível abrir o armazenamento: '+e.message
    });