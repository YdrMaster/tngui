// 5-step SecureFlow 常量，从 tng-client mock.ts 移植
export interface SecureStep {
  key: string;
  title: string;
  shortTitle: string;
  description: string;
}

export const secureSteps: SecureStep[] = [
  { key: 'local', title: '本地接收请求', shortTitle: '本地输入', description: '应用仅监听 127.0.0.1，请求明文不离开本机。' },
  { key: 'attestation', title: '验证云端可信环境', shortTitle: '可信验证', description: '校验硬件证明、软件度量和服务身份。' },
  { key: 'encrypt', title: '建立加密通道', shortTitle: '请求加密', description: '验证结果与 RATS-TLS 会话绑定后再发送请求。' },
  { key: 'inference', title: '可信区内推理', shortTitle: '密态推理', description: '请求仅在云端可信执行环境内解密和计算。' },
  { key: 'decrypt', title: '本地解密响应', shortTitle: '本地输出', description: '响应以密文返回，由本地 TNG 网关解密。' },
];
