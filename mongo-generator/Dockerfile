# Copyright © 2018 CA. All rights reserved.  CA Confidential.  Please see License.txt file for applicable usage rights and restrictions.
ARG tdmVersion

FROM tdm/action-service:$tdmVersion

RUN apt-get -y update && apt-get install -y curl \
  && curl -sL https://deb.nodesource.com/setup_9.x | bash - \
  && apt-get install -y nodejs \
  && curl -L https://www.npmjs.com/install.sh | sh

RUN npm i -g typescript && npm cache verify

WORKDIR /opt

RUN keytool -genkeypair -dname cn=tdm -alias jetty -keypass super-secret -storepass secret -keyalg RSA -keysize 2048 -keystore keystore.jks -validity 3650

COPY ["package.json","tsconfig.json","dist/src/*.js","tdm/TDMActionService.jar","/opt/"]

RUN npm install

ENV PUBLISH_ACTION="node /opt/mongo-generator.js init"

#TDM Action Service - REST
ENTRYPOINT ["java", "-jar", "TDMActionService.jar"]