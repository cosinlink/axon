import { RelayToCkbBufferConsumer } from "./consumers/RelayToCkbBufferConsumer";
import { CkbListener } from "./relayers/CkbListener";
import { MutaListener } from "./relayers/MutaListener";

new MutaListener().start();
new CkbListener().start();
// new RelayToCkbBufferConsumer().start();
