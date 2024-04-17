FROM node:20.5.0-bookworm AS build
WORKDIR /app
COPY ./package*.json ./
RUN npm ci
COPY ./ ./
RUN npm run build

FROM node:20.5.0-bookworm
WORKDIR /app
COPY ./data /app/data
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y libasound2
COPY --from=build /app/package.json /app/package-lock.json /app/
RUN npm ci
COPY --from=build /app/dist /app/dist
EXPOSE 8080
CMD ["node", "/app/dist/server.node.js"]
