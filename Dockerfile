FROM ghcr.io/puppeteer/puppeteer:21.1.0 
WORKDIR /home/pptruser
RUN rm           package-lock.json
ADD package.json package.json
RUN yarn install
ADD init.js	      /home/pptruser/init.js
EXPOSE 8101

CMD ["node", "/home/pptruser/init.js"]