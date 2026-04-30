"""点云数据读取与预处理"""
import numpy as np
import torch
import os
from ..config import CLASS_NAMES, NUM_CLASSES


def load_pth_pointcloud(file_path: str) -> np.ndarray:
    """
    读取 .pth 点云文件，返回 (N, 7) numpy 数组。
    格式: x, y, z, r, g, b, label_id
    同时兼容 .npy 文件。
    """
    ext = os.path.splitext(file_path)[1].lower()
    if ext == ".pth":
        data = torch.load(file_path, map_location="cpu", weights_only=False)
        if isinstance(data, np.ndarray):
            pass  # 已经是 numpy
        elif isinstance(data, torch.Tensor):
            data = data.numpy()
        elif isinstance(data, dict):
            for key in ["points", "data", "point_cloud"]:
                if key in data:
                    d = data[key]
                    data = d.numpy() if isinstance(d, torch.Tensor) else np.array(d)
                    break
            else:
                raise ValueError(f"无法从 .pth dict 中解析点云, keys: {list(data.keys())}")
    elif ext == ".npy":
        data = np.load(file_path)
    else:
        raise ValueError(f"不支持的文件格式: {ext}")

    data = np.array(data, dtype=np.float32)
    if data.ndim != 2 or data.shape[1] < 6:
        raise ValueError(f"点云数据形状异常: {data.shape}, 期望 (N, >=6)")
    return data


def get_pointcloud_info(data: np.ndarray) -> dict:
    """获取点云基本信息"""
    info = {
        "num_points": int(data.shape[0]),
        "shape": list(data.shape),
        "has_labels": data.shape[1] >= 7,
        "xyz_min": data[:, :3].min(axis=0).tolist(),
        "xyz_max": data[:, :3].max(axis=0).tolist(),
    }
    if info["has_labels"]:
        labels = data[:, 6].astype(int)
        unique, counts = np.unique(labels, return_counts=True)
        info["label_distribution"] = {
            CLASS_NAMES[int(u)]: int(c) for u, c in zip(unique, counts) if int(u) < NUM_CLASSES
        }
    return info


def preprocess_for_inference(data: np.ndarray, block_size: float = 50.0,
                              num_point: int = 4096, stride: float = 25.0):
    """
    将完整场景点云预处理为可推理的 batch 格式。
    输入: (N, >=6), 前6列为 xyz+rgb
    输出: batched_data (M, num_point, 9), point_indices (M, num_point)

    9通道: centered_xyz(3) + rgb_normalized(3) + normalized_xyz(3)
    """
    points_xyz = data[:, :3].copy()
    rgb = data[:, 3:6] / 255.0

    coord_min = points_xyz.min(axis=0)
    coord_max = points_xyz.max(axis=0)
    safe_max = np.where(coord_max == 0, 1.0, coord_max)

    grid_x = int(np.ceil(float(coord_max[0] - coord_min[0] - block_size) / stride) + 1)
    grid_y = int(np.ceil(float(coord_max[1] - coord_min[1] - block_size) / stride) + 1)
    grid_x = max(grid_x, 1)
    grid_y = max(grid_y, 1)

    data_list, index_list = [], []
    padding = 0.001

    for iy in range(grid_y):
        for ix in range(grid_x):
            s_x = coord_min[0] + ix * stride
            e_x = min(s_x + block_size, coord_max[0])
            s_x = e_x - block_size
            s_y = coord_min[1] + iy * stride
            e_y = min(s_y + block_size, coord_max[1])
            s_y = e_y - block_size

            mask = (
                (points_xyz[:, 0] >= s_x - padding) & (points_xyz[:, 0] <= e_x + padding) &
                (points_xyz[:, 1] >= s_y - padding) & (points_xyz[:, 1] <= e_y + padding)
            )
            point_idxs = np.where(mask)[0]
            if point_idxs.size == 0:
                continue

            num_batch = int(np.ceil(point_idxs.size / num_point))
            point_size = num_batch * num_point
            if point_size > point_idxs.size:
                replace = (point_size - point_idxs.size) > point_idxs.size
                extra = np.random.choice(point_idxs, point_size - point_idxs.size, replace=replace)
                point_idxs = np.concatenate((point_idxs, extra))
            np.random.shuffle(point_idxs)

            batch_xyz = points_xyz[point_idxs, :].copy()
            batch_rgb = rgb[point_idxs, :]
            normalized_xyz = batch_xyz / safe_max
            batch_xyz[:, 0] -= (s_x + block_size / 2.0)
            batch_xyz[:, 1] -= (s_y + block_size / 2.0)
            features = np.concatenate((batch_xyz, batch_rgb, normalized_xyz), axis=1)

            data_list.append(features)
            index_list.append(point_idxs)

    if not data_list:
        return np.zeros((1, num_point, 9), dtype=np.float32), np.zeros((1, num_point), dtype=np.int64)

    all_data = np.concatenate(data_list, axis=0).reshape(-1, num_point, 9)
    all_idx = np.concatenate(index_list, axis=0).reshape(-1, num_point)
    return all_data.astype(np.float32), all_idx.astype(np.int64)
