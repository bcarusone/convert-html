'use strict';
const buffer     = require('buffer');
const express    = require('express');
const bodyParser = require('body-parser');
const puppeteer  = require('puppeteer');

const PORT = '8101';
const MIMETYPES = {
  'image/png':       'png',
  'image/jpeg':      'jpeg',
  'image/webp':      'webp',
  'application/pdf': 'pdf',
  'text/html':       'html',
  'text/plain':      'text',
  'text/xml'  :      'text',
};

var Webrender = express();

(async () => {
  Webrender.use(bodyParser.text({
    "type": "*/*",
    "limit": "4mb"
  }));

  // /webrender
  //    Render a URL with a plethora of options
  //
  //    Query Params:
  //        ?url          The URL to render               [required]
  //        ?width        Browser window width            (default: 1280)
  //        ?height       Browser window heigh            (default: 1024)
  //        ?scale        Display scale factor            (default: 1.0)
  //        ?mobile       Emulate a mobile device         (default: false)
  //        ?touch        The device is touch capable     (default: false)
  //        ?landscape    Device orientation              (default: false)
  //        ?emulate      Emulate a specific device       see: https://pptr.dev/api/puppeteer.knowndevices
  //        ?mimetype     The output type                 (default: application/pdf)
  //        ?full         Capture the full webpage        (default: false)
  //        ?alpha        Allow transparent backgrounds   (default: false)
  Webrender.all('/webrender', async (request, response) => {
    try {
      var URL         = request.query.url;
      var WIDTH       = parseInt(request.query.width  || '1280');
      var HEIGHT      = parseInt(request.query.height || '1024');
      var DEVICE      = request.query.emulate;
      var MIMETYPE    = (request.query.mimetype || 'image/png').split(';').filter((v) => {
          return MIMETYPES[v.toLowerCase()]
      })[0];
      var CHROMEPATH  = process.env.WEBRENDER_CHROME_PATH;

      if (!MIMETYPE) {
        return respondError(response, `Must request an output type using ?mimetype or the 'Accept' request header`, 406);
      }

      const BROWSER = await puppeteer.launch({
        headless:            'new',
        executablePath:      CHROMEPATH,
        ignoreHTTPSErrors:   true,
        acceptInsecureCerts: true,
        args: [
            '--proxy-bypass-list=*',
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--disable-setuid-sandbox',
            '--no-first-run',
            '--no-sandbox',
            '--no-zygote',
            '--single-process',
            '--ignore-certificate-errors',
            '--ignore-certificate-errors-spki-list',
            '--enable-features=NetworkService',
        ],
      });

      const PAGE = await BROWSER.newPage();

      if (DEVICE) {
        await PAGE.emulate(puppeteer.KnownDevices[DEVICE]);
      } else if (WIDTH & HEIGHT) {
        await PAGE.emulate({
          userAgent: 'Custom',
          viewport: {
            height:            HEIGHT,
            width:             WIDTH,
            deviceScaleFactor: parseFloat(request.query.scale || 1.0),
            hasTouch:          parseBool(request.query.touch),
            isLandscape:       parseBool(request.query.landscape),
            isMobile:          parseBool(request.query.mobile),
          },
        });
      }

      if (URL) {
        // decode base64 encoded URL
        if (URL && URL.startsWith('base64:')) {
          URL = (new buffer.Buffer.from(URL.slice(7), 'base64').toString('ascii'));
        }

        // normalize
        if (!URL.match(/^https?:\/\//)) {
          URL = `https://${URL}`;
        }

        // force wait until load is complete
        var p_res = await PAGE.goto(URL, {
          waitUntil: 'networkidle2',
        });
      } else {
        await PAGE.setContent(request.body, {
          waitUntil: 'networkidle0',
        });
      }

      var output = null;

      // determine which call to use depending on the requested type
      switch (MIMETYPE) {
        case 'application/pdf':
          output = await PAGE.pdf({
            format: 'letter',
            printBackground: true,
          });
          break;
        case 'text/plain':
        case 'text/html':
        case 'text/xml':
          output = await PAGE.content();
          break;
        default: 
          output = await PAGE.screenshot({
            fullPage:       parseBool(request.query.full),
            omitBackground: parseBool(request.query.alpha),
          });
          break;
      }

      // close the browser
      await BROWSER.close();

      response.set('Content-Type',        MIMETYPE)  // set the proper MIME type
      response.set('Content-Disposition', 'inline')  // try to convince the browser to display it
      response.send(output);

    } catch (exc) {
      return respondError(response, exc.toString());
    }
  })

  Webrender.get('/health', async (req, res) => {
      res.json({
          status:  'ok',
          service: 'webrender',
      });
  })

  console.log(`Starting WebRender server on :${PORT}`);
  Webrender.listen(PORT);
})();

function respondError(response, message, code) {
  code = code || 400;

  response.status(code);
  response.set('Content-Type', 'application/json');
  response.json({
      error: message,
  });
  console.error({
      error:            true,
      message:          message,
      http_status_code: code,
  });
  return;
}

function parseBool(str) {
  if (!str) { return false }

  switch (str.toLowerCase()) {
      case 'true':
          return true;
      case 'false':
          return false;
      default:
          try {
              return parseInt(str) > 0;
          } catch (e) {
              return false;
          }
  }
}