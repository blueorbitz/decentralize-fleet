import React from 'react';
import ReactDOM from 'react-dom';
import '@atlaskit/css-reset';
import './presence.css';
import { view } from '@forge/bridge';
import App from './App.jsx';

// Custom UI must enable theming before any design token resolves.
view.theme.enable().finally(() => {
  ReactDOM.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
    document.getElementById('root'),
  );
});
