/*!
 *
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

import { URL } from 'url';
import ContextManager from '../trace/context/ContextManager';
import { Component } from '../trace/Component';
import Tag from '../Tag';
import { SpanLayer } from '../proto/language-agent/Tracing_pb';
import { ContextCarrier } from '../trace/context/ContextCarrier';
import Span from '../trace/span/Span';
import DummySpan from '../trace/span/DummySpan';
import { ignoreHttpMethodCheck } from '../config/AgentConfig';
import { AWSLambdaTriggerPlugin } from './AWSLambdaTriggerPlugin';

class AWSLambdaGatewayAPIHTTP extends AWSLambdaTriggerPlugin {
  start(event: any, context: any): Span {
    const headers = event.headers;
    const reqCtx = event.requestContext;
    const http = reqCtx?.http;
    const method = http?.method;
    const proto = http?.protocol ? http.protocol.split('/')[0].toLowerCase() : headers?.['x-forwarded-proto'];
    const port = headers?.['x-forwarded-port'] || '';
    const host = headers?.host ?? (reqCtx?.domainName || '');
    const hostport = host ? (port ? `${host}:${port}` : host) : port;
    const operation = http?.path ?? event.rawPath ?? (context.functionName ? `/${context.functionName}` : '/');

    const query = event.rawQueryString
      ? `?${event.rawQueryString}`
      : event.queryStringParameters
      ? '?' +
        Object.entries(event.queryStringParameters)
          .map(([k, v]) => `${k}=${v}`)
          .join('&')
      : '';

    const carrier = headers && ContextCarrier.from(headers);

    const span =
      method && ignoreHttpMethodCheck(method)
        ? DummySpan.create()
        : ContextManager.current.newEntrySpan(operation, carrier);

    span.layer = SpanLayer.HTTP;
    span.component = Component.AWSLAMBDA_GATEWAYAPIHTTP;
    span.peer = http?.sourceIp ?? headers?.['x-forwarded-for'] ?? 'Unknown';

    if (method) span.tag(Tag.httpMethod(method));

    if (hostport && proto) span.tag(Tag.httpURL(new URL(`${proto}://${hostport}${operation}${query}`).toString()));

    span.start();

    return span;
  }

  stop(span: Span, err: Error | null, res: any): void {
    const statusCode = res?.statusCode || (typeof res === 'number' ? res : err ? 500 : null);

    if (statusCode) {
      if (statusCode >= 400) span.errored = true;

      span.tag(Tag.httpStatusCode(statusCode));
    }

    span.stop();
  }
}

export default new AWSLambdaGatewayAPIHTTP();
