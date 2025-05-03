import { HashMap } from "@utils/hashmap";
import { HashSet } from "@utils/hashset";
import type { Hashable } from "@utils/interfaces";

export class MultiValueHashMap<K extends Hashable, V extends Hashable> extends HashMap<
    K,
    HashSet<V>
> {
    add(key: K, value: V): MultiValueHashMap<K, V> {
        let hashSet: HashSet<V> = this.get(key);
        if (!hashSet) {
            hashSet = new HashSet([value]);
        } else {
            hashSet.add(value);
        }

        this.set(key, hashSet);
        return this;
    }
}
