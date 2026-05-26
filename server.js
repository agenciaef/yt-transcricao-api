import express from "express";
import cors from "cors";
import { YoutubeTranscript } from "youtube-transcript";

const app = express();

const PORT = process.env.PORT || 3000;
const API_TOKEN = process.env.API_TOKEN || "glCqYQD5mDcpMTn6lvf0CkE3tNbWbul4";

app.use(cors());
app.use(express.json({ limit: "20mb" }));

function validarToken(req, res, next) {
  const tokenRecebido = req.headers["x-api-token"];

  if (!API_TOKEN) {
    return next();
  }

  if (tokenRecebido !== API_TOKEN) {
    return res.status(401).json({
      success: false,
      error: "Token inválido ou ausente."
    });
  }

  next();
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

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "API de transcrição do YouTube online.",
    endpoints: {
      health: "GET /health",
      transcrever: "POST /transcrever"
    }
  });
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "online",
    timestamp: new Date().toISOString()
  });
});

app.post("/transcrever", validarToken, async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: "Envie a URL do vídeo no body como { url: '...' }."
      });
    }

    const videoId = extrairVideoId(url);

    console.log("Recebida solicitação de transcrição:");
    console.log("URL:", url);
    console.log("Video ID:", videoId);

    const transcript = await YoutubeTranscript.fetchTranscript(videoId);

    const transcricao = transcript
      .map((item) => item.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (!transcricao) {
      return res.status(404).json({
        success: false,
        url,
        videoId,
        error: "Transcrição vazia ou indisponível."
      });
    }

    return res.json({
      success: true,
      url,
      videoId,
      transcricao,
      tamanhoTexto: transcricao.length,
      data: new Date().toLocaleString("pt-BR")
    });

  } catch (error) {
    console.error("Erro ao transcrever:", error.message);

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`API rodando na porta ${PORT}`);
});
