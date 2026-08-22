import { createApp } from "vue";
import Antd from "ant-design-vue";
import "ant-design-vue/dist/reset.css";
import App from "./App.vue";

// AntDV 4 用 CSS-in-JS，全局注册即可带样式（无需 unplugin 按需 style 导入）。
createApp(App).use(Antd).mount("#app");