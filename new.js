import axios from 'axios';
import fs from 'fs/promises';
import readline from 'readline';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { createCanvas, loadImage } from 'canvas';
import chalk from 'chalk';
import cfonts from 'cfonts';
import ora from 'ora';

function delay(seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

async function countdown(ms) {
  const seconds = Math.floor(ms / 1000);
  const spinner = ora().start();
  for (let i = seconds; i > 0; i--) {
    spinner.text = chalk.gray(` Waiting ${i} Seconds Before Next Upload...`);
    await delay(1);
  }
  spinner.stop(); 
}

function generateRandomFilename() {
  const randomStr = Math.random().toString(36).substring(2, 10); 
  return `invoice_user-${randomStr}.png`;
}

function centerText(text, color = 'yellowBright') {
  const terminalWidth = process.stdout.columns || 80;
  const textLength = text.length;
  const padding = Math.max(0, Math.floor((terminalWidth - textLength) / 2));
  return ' '.repeat(padding) + chalk[color](text);
}

function shorten(str, frontLen = 6, backLen = 4) {
  if (!str || str.length <= frontLen + backLen) return str;
  return `${str.slice(0, frontLen)}....${str.slice(-backLen)}`;
}

async function readTokens() {
  try {
    const data = await fs.readFile('token.txt', 'utf-8');
    return data.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  } catch (error) {
    console.error(chalk.red(`Error membaca token.txt: ${error.message}`));
    return [];
  }
}

async function readProxies() {
  try {
    const data = await fs.readFile('proxy.txt', 'utf-8');
    const proxies = data.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    if (proxies.length === 0) {
      console.log(chalk.yellow('File proxy.txt kosong. Melanjutkan tanpa proxy.'));
    }
    return proxies;
  } catch (error) {
    console.log(chalk.yellow('File proxy.txt tidak ditemukan. Melanjutkan tanpa proxy.'));
    return [];
  }
}

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => rl.question(query, ans => {
    rl.close();
    resolve(ans);
  }));
}

function getHeaders(token = '') {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Encoding': 'gzip, deflate, br',
    'Content-Type': 'application/json',
    'Origin': 'https://polyflow.tech',
    'Referer': 'https://polyflow.tech/',
    'Authorization': `Bearer ${token}`
  };
}

function getAxiosConfig(token = null, proxy = null) {
  const config = {
    headers: getHeaders(token),
  };
  if (proxy) {
    if (proxy.startsWith('http://') || proxy.startsWith('https://')) {
      config.httpsAgent = new HttpsProxyAgent(proxy);
    } else if (proxy.startsWith('socks4://') || proxy.startsWith('socks5://')) {
      config.httpsAgent = new SocksProxyAgent(proxy);
    }
  }
  return config;
}

async function getPublicIP(proxy) {
  try {
    const config = proxy ? { httpsAgent: proxy.startsWith('http') ? new HttpsProxyAgent(proxy) : new SocksProxyAgent(proxy) } : {};
    const response = await axios.get('https://api.ipify.org?format=json', config);
    return response.data.ip;
  } catch (error) {
    return 'Error getting IP';
  }
}

async function getAccountInfo(token, proxy) {
  const spinner = ora(' Getting Account Info...').start();
  try {
    const response = await axios.get('https://api-v2.polyflow.tech/api/user', getAxiosConfig(token, proxy));
    const data = response.data.msg;
    spinner.succeed(chalk.greenBright(' Account Info Received'));
    return { addres: data.address, accountId: data.account_id };
  } catch (error) {
    spinner.fail(chalk.redBright(` Failed Reading Account: ${error.message}`));
    return null;
  }
}

async function createReceiptBuffer() {
  const canvasObj = createCanvas(550, 715);
  const ctx = canvasObj.getContext('2d');
  const img = await loadImage('image.png');
  ctx.drawImage(img, 0, 0, canvasObj.width, canvasObj.height);
  const btcAmount = (Math.random() * (0.00005 - 0.00001) + 0.000010).toFixed(8);
  const cashbackAmount = (Math.random() * (0.000000150 - 0.0000010) + 0.0000010).toFixed(8);
  ctx.font = '28px Arial';
  ctx.fillStyle = '#00C374';
  ctx.textAlign = 'center';
  ctx.fillText(`BTC ${btcAmount}`, canvasObj.width / 2, 435);
  ctx.font = '18px Arial';
  ctx.fillStyle = '#00C374';
  ctx.fillText(`+ BTC ${cashbackAmount}`, canvasObj.width / 1.6, 512);
  return canvasObj.toBuffer('image/png');
}

async function getPresignedUrl(filename, token, proxy) {
  try {
    const response = await axios.get(`https://api-v2.polyflow.tech/api/scan2earn/get_presigned_url?file_name=${filename}`, getAxiosConfig(token, proxy));
    return response.data.msg;
  } catch (error) {
    return null;
  }
}

async function uploadFile(presignedUrl, fileBuffer, proxy) {
  try {
    const config = proxy ? { httpsAgent: proxy.startsWith('http') ? new HttpsProxyAgent(proxy) : new SocksProxyAgent(proxy) } : {};
    config.headers = { 'Content-Type': 'application/octet-stream' };
    const response = await axios.put(presignedUrl, fileBuffer, config);
    return response.status === 200;
  } catch (error) {
    return false;
  }
}

async function completeDailyTask(token, proxy) {
  const mainSpinner = ora(' Completing Daily Task...').start();
  try {
    const response = await axios.get(
      'https://api-v2.polyflow.tech/api/account/personalcenter/quests/daily',
      getAxiosConfig(token, proxy)
    );
    const tasks = response.data.msg.quests.filter(t => !t.completed_today);
  
    for (const task of tasks) {
      const taskSpinner = ora(`→ ${task.title}`).start();
      const taskResponse = await axios.post(
        'https://api-v2.polyflow.tech/api/account/personalcenter/quests/complete',
        { quest_id: task.id },
        getAxiosConfig(token, proxy)
      );
  
      if (taskResponse.data.success) {
        taskSpinner.succeed(chalk.greenBright(` Task ${task.title} Done. Points: ${taskResponse.data.msg.points}`));
      } else {
        taskSpinner.fail(chalk.greenBright(` Task ${task.title} Failed`));
      }
    }  
    mainSpinner.succeed(chalk.greenBright(' All Daily Tasks Already Done'));
  } catch (error) {
    mainSpinner.fail(chalk.redBright(` Failed Completing Daily Task: ${error.message}`));
  }
}

async function claimbonus(token, proxy) {
  const spinner = ora(' Claiming Daily Bonus...').start();
  try {
    const response = await axios.post(
      'https://api-v2.polyflow.tech/api/account/personalcenter/quests/daily/claim-reward',
      {},
      getAxiosConfig(token, proxy)
    );

    const message = response.data.msg.message || '';
    if (message.includes('already')) {
      spinner.info(chalk.yellowBright(' Daily Bonus Already Claimed'));
    } else if (message.includes('claimed successfully')) {
      const points = response.data.msg.points || 0;
      spinner.succeed(chalk.greenBright(` Daily Bonus Claimed Successfully! Points: ${points}`));
    } else {
      spinner.warn(chalk.gray(` Unknown Claim Status: ${message}`));
    }
  } catch (error) {
    spinner.fail(chalk.redBright(` Error Claiming Daily Bonus: ${error.message}`));
  }
}

async function showTotalPoints(token, proxy) {
  const spinner = ora(' Getting Points Info...').start();
  try {
    const response = await axios.get('https://api-v2.polyflow.tech/api/account/personalcenter/dashboard', getAxiosConfig(token, proxy));
    const totalPoints = response.data.msg.total_points;
    spinner.succeed(chalk.greenBright(` Total Points: ${totalPoints}`));
  } catch (error) {
    spinner.fail(chalk.redBright(` Error: ${error.message}`));
  }
}

async function processAccount(token, proxy, uploadCount) {
  const accountInfo = await getAccountInfo(token, proxy);
  if (!accountInfo) {
    console.error(chalk.red(`Token tidak valid atau akun tidak ditemukan`));
    return;
  }
  const { addres, accountId } = accountInfo;
  console.log();
  console.log(chalk.bold.whiteBright(`Address          : ${shorten(addres)}`));
  console.log(chalk.bold.whiteBright(`Account ID       : ${shorten(accountId)}`));
  const ip = await getPublicIP(proxy);
  console.log(chalk.bold.whiteBright(`IP yang Digunakan: ${ip}`));
  console.log(chalk.bold.cyanBright('='.repeat(80)));
  console.log();
  for (let j = 0; j < uploadCount; j++) {
    const uploadSpinner = ora(` Mengunggah Invoice ${j + 1}/${uploadCount}...`).start();
    try {
      uploadSpinner.text = ' Membuat Invoice...';
      const buffer = await createReceiptBuffer();
      const filename = generateRandomFilename();
      
      uploadSpinner.text = ' Mendapatkan Presigned URL...';
      const presignedData = await getPresignedUrl(filename, token, proxy);
      if (!presignedData) {
        throw new Error(' Gagal Mendapatkan Presigned URL');
      }

      uploadSpinner.text = ' Mengunggah File...';
      const uploaded = await uploadFile(presignedData.presigned_url, buffer, proxy);
      if (!uploaded) {
        throw new Error(' Gagal Mengunggah File');
      }

      uploadSpinner.text = ' Mengirim Invoice...';
      await axios.post('https://api-v2.polyflow.tech/api/scan2earn/save_invoice', {
        invoice_path: presignedData.key
      }, getAxiosConfig(token, proxy));

      uploadSpinner.succeed(chalk.greenBright(` Invoice ${j + 1}/${uploadCount} Berhasil Diunggah`) + chalk.gray(` - Filename: ${filename}`));
      if (j < uploadCount - 1) {
        const randomDelay = Math.floor(Math.random() * (30000 - 10000 + 1)) + 10000;
        await countdown(randomDelay);
      }    
    } catch (error) {
      uploadSpinner.fail(chalk.redBright(` Gagal Mengunggah Invoice ${j + 1}/${uploadCount}: ${error.message}`));
    }
  }

  await completeDailyTask(token, proxy);
  await claimbonus(token, proxy);
  await showTotalPoints(token, proxy);
  console.log(chalk.yellowBright(`\n Selesai Memproses Akun: ${shorten(addres)}`));
}

async function run() {
  cfonts.say('NT EXHAUST', {
    font: 'block',
    align: 'center',
    colors: ['cyan', 'magenta'],
    background: 'transparent',
    letterSpacing: 1,
    lineHeight: 1,
    space: true,
    maxLength: '0'
  });
  console.log(centerText("=== Telegram Channel 🚀 : NT Exhaust (@NTExhaust) ==="));
  console.log(centerText("✪ POLYFLOW AUTO DAILY TASK & UPLOAD FILES ✪ \n"));

  const useProxyAns = await askQuestion('Ingin Menggunakan Proxy? (y/n): ');
  const useProxy = useProxyAns.trim().toLowerCase() === 'y';
  let proxies = [];
  if (useProxy) {
    proxies = await readProxies();
    if (proxies.length === 0) {
      console.log(chalk.yellow('Proxy Tidak Tersedia, Melanjutkan Tanpa Proxy.'));
    }
  }
  const uploadCount = parseInt(await askQuestion('Berapa Banyak Invoice yang Ingin Diunggah Per Akun dan Perulangan?: '), 10);
  const tokens = await readTokens();

  while (true) {
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const proxy = proxies.length > 0 ? proxies[i % proxies.length] : null;
      console.log();
      console.log(chalk.bold.cyanBright('='.repeat(80)));
      console.log(chalk.bold.whiteBright(`Akun: ${i + 1}/${tokens.length}`));
      await processAccount(token, proxy, uploadCount);
    }
    console.log(chalk.grey('\n Menunggu 24 Jam Sebelum Perulangan Berikutnya...'));
    await delay(86400);
  }
}

run().catch(error => console.error(chalk.red(`Error utama: ${error.message}`)));
