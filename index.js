import { google } from "googleapis";
import { YoutubeTranscript } from "youtube-transcript";
import ExcelJS from "exceljs";
import fs from "fs";
import axios from "axios";

const WEBHOOK_N8N = "https://n8n.tuagencia.com.br/webhook/youtube-transcricao";
const SPREADSHEET_ID = "1yWlyhY4jrB5e2PhumRG-9eGpK7xPG2pzUODyprEL1IU";
const NOME_ABA = "Link dos vídeos";

const INTERVALO_EM_MS = 60 * 1000;

const auth = new google.auth.GoogleAuth({
  keyFile: "./credentials.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const sheets = google.sheets({
  version: "v4",
  auth
});

function normalizarTexto(texto) {
  return String(texto || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function extrairVideoId(url) {
  try {
    const urlObj = new URL(url);

    if (urlObj.hostname.includes("youtu.be")) {
      return urlObj.pathname.replace("/", "").split("?")[0];
    }

    if (urlObj.searchParams.get("v")) {
      return urlObj.searchParams.get("v");
    }

    if (urlObj.pathname.includes("/shorts/")) {
      return urlObj.pathname.split("/shorts/")[1].split("/")[0];
    }

    return url;
  } catch {
    return url;
  }
}

async function buscarLinhasDaPlanilha() {
  const resposta = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${NOME_ABA}!A:E`
  });

  const linhas = resposta.data.values || [];

  if (linhas.length <= 1) {
    return [];
  }

  const cabecalho = linhas[0];

  return linhas.slice(1).map((linha, index) => {
    return {
      numeroLinha: index + 2,
      url: linha[0] || "",
      status: linha[1] || "",
      videoId: linha[2] || "",
      dataTranscricao: linha[3] || "",
      erro: linha[4] || "",
      cabecalho
    };
  });
}

async function buscarProximoPendente() {
  const linhas = await buscarLinhasDaPlanilha();

  const pendente = linhas.find((linha) => {
    return linha.url && normalizarTexto(linha.status) === "pendente";
  });

  return pendente || null;
}

async function atualizarLinha(numeroLinha, dados) {
  const valores = [
    [
      dados.status || "",
      dados.videoId || "",
      dados.dataTranscricao || "",
      dados.erro || ""
    ]
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${NOME_ABA}!B${numeroLinha}:E${numeroLinha}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: valores
    }
  });
}

async function marcarComoProcessando(numeroLinha, videoId) {
  await atualizarLinha(numeroLinha, {
    status: "processando",
    videoId,
    dataTranscricao: "",
    erro: ""
  });
}

async function marcarComoConcluido(numeroLinha, videoId) {
  await atualizarLinha(numeroLinha, {
    status: "concluido",
    videoId,
    dataTranscricao: new Date().toLocaleString("pt-BR"),
    erro: ""
  });
}

async function marcarComoErro(numeroLinha, videoId, erro) {
  await atualizarLinha(numeroLinha, {
    status: "erro",
    videoId,
    dataTranscricao: new Date().toLocaleString("pt-BR"),
    erro: String(erro || "").slice(0, 400)
  });
}

async function salvarNaPlanilhaLocal(dados) {
  const caminhoArquivo = "./transcricoes.xlsx";
  const workbook = new ExcelJS.Workbook();

  let worksheet;

  if (fs.existsSync(caminhoArquivo)) {
    await workbook.xlsx.readFile(caminhoArquivo);
    worksheet = workbook.getWorksheet("Transcrições");
  }

  if (!worksheet) {
    worksheet = workbook.addWorksheet("Transcrições");

    worksheet.columns = [
      { header: "Data", key: "data", width: 20 },
      { header: "URL", key: "url", width: 45 },
      { header: "Video ID", key: "videoId", width: 20 },
      { header: "Status", key: "status", width: 20 },
      { header: "Transcrição", key: "transcricao", width: 120 }
    ];
  }

  worksheet.addRow(dados);

  await workbook.xlsx.writeFile(caminhoArquivo);

  console.log("Salvo no Excel local: transcricoes.xlsx");
}

function salvarEmTxt(dados) {
  const caminhoArquivo = "./transcricoes.txt";

  const conteudo = `
========================================
DATA: ${dados.data}
URL: ${dados.url}
VIDEO ID: ${dados.videoId}
STATUS: ${dados.status}
========================================

${dados.transcricao}

\n\n`;

  fs.appendFileSync(caminhoArquivo, conteudo, "utf8");

  console.log("Salvo no TXT local: transcricoes.txt");
}

async function enviarParaN8n(dados) {
  if (!WEBHOOK_N8N || WEBHOOK_N8N === "COLE_AQUI_A_URL_DO_WEBHOOK") {
    console.log("Webhook do n8n não configurado. Pulando envio.");
    return;
  }

  const payload = {
    origem: "youtube-transcricao-planilha",
    data: dados.data,
    url: dados.url,
    videoId: dados.videoId,
    status: dados.status,
    transcricao: dados.transcricao,
    tamanhoTexto: dados.transcricao.length
  };

  const resposta = await axios.post(WEBHOOK_N8N, payload, {
    headers: {
      "Content-Type": "application/json"
    },
    timeout: 60000
  });

  console.log("Enviado para o n8n com sucesso.");
  console.log("Status webhook:", resposta.status);
}

async function transcreverVideo(url) {
  const videoId = extrairVideoId(url);

  console.log("Buscando transcrição...");
  console.log("URL:", url);
  console.log("Video ID:", videoId);

  const transcript = await YoutubeTranscript.fetchTranscript(videoId);

  const textoCompleto = transcript
    .map((item) => item.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (!textoCompleto) {
    throw new Error("Transcrição vazia ou indisponível.");
  }

  return {
    videoId,
    transcricao: textoCompleto
  };
}

async function processarUmVideo() {
  console.log("");
  console.log("========================================");
  console.log("Verificando planilha...");
  console.log("========================================");

  const linha = await buscarProximoPendente();

  if (!linha) {
    console.log("Nenhum vídeo pendente encontrado.");
    return;
  }

  const url = linha.url;
  const videoId = extrairVideoId(url);

  console.log("Vídeo pendente encontrado:");
  console.log("Linha:", linha.numeroLinha);
  console.log("URL:", url);

  try {
    await marcarComoProcessando(linha.numeroLinha, videoId);

    const resultado = await transcreverVideo(url);

    const dados = {
      data: new Date().toLocaleString("pt-BR"),
      url,
      videoId: resultado.videoId,
      status: "concluido",
      transcricao: resultado.transcricao
    };

    await salvarNaPlanilhaLocal(dados);
    salvarEmTxt(dados);
    await enviarParaN8n(dados);

    await marcarComoConcluido(linha.numeroLinha, resultado.videoId);

    console.log("Processo finalizado e status atualizado para concluido.");

  } catch (error) {
    console.error("Erro ao processar vídeo.");
    console.error(error.message);

    await marcarComoErro(linha.numeroLinha, videoId, error.message);
  }
}

async function iniciarRobo() {
  console.log("Robô iniciado.");
  console.log(`Intervalo: ${INTERVALO_EM_MS / 1000} segundos`);
  console.log("Pressione CTRL + C para parar.");

  await processarUmVideo();

  setInterval(async () => {
    try {
      await processarUmVideo();
    } catch (error) {
      console.error("Erro geral no ciclo do robô:");
      console.error(error.message);
    }
  }, INTERVALO_EM_MS);
}

iniciarRobo();